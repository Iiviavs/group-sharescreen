// golive-audiocap — system audio capture that leaves GoLive out of it.
//
// Why this is a separate executable and not a Node addon
// ------------------------------------------------------
// Everything here could have been an N-API module loaded into the Electron
// main process. It is a standalone .exe instead, for three reasons that all
// bite later rather than now:
//
//   1. A native addon is bound to a Node/Electron ABI. Every Electron bump
//      would need a rebuild and a matching prebuild for every arch, and a
//      mismatch is a hard crash at require() time — in an app that
//      auto-updates its own shell. A plain Win32 executable has no ABI to
//      match: it keeps working across Electron versions untouched.
//   2. Real-time audio capture runs its own thread at MMCSS "Pro Audio"
//      priority and blocks on an event. Doing that inside the process that
//      also runs Chromium is asking for the two to interfere.
//   3. If this crashes — a driver going away mid-capture is a real thing —
//      it takes down a 200 KB helper, not the call the user is in.
//
// What it does
// ------------
// Captures the system audio mix *excluding* one process tree, using the
// WASAPI process-loopback activation path (AUDIOCLIENT_ACTIVATION_PARAMS
// with PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE), and writes the
// result to stdout as raw PCM.
//
// That exclusion is the entire point. GoLive plays every remote
// participant's voice and every remote screen share through its own audio
// output; an ordinary loopback capture picks those up and sends them
// straight back to the room, so everyone hears themselves a beat late. The
// target process id passed on the command line is Electron's main process,
// and "process tree" covers its children — which is where Chromium actually
// renders audio, since the audio service is a child utility process rather
// than part of the renderer.
//
// Derived from Microsoft's ApplicationLoopback sample:
// https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/
//
// Which Windows versions this works on
// ------------------------------------
// Not decided here, and deliberately not decided from a build number
// anywhere else either. Microsoft documents process loopback as needing
// build 20348 — a number that reads as "Windows 11 only", since consumer
// Windows 10 stops at 19045 — but that is Server 2022's build, and the
// sample is reported working on Windows 10 22H2 all the same. What actually
// fails on Windows 10 is GetMixFormat/IsFormatSupported, which return
// E_NOTIMPL (see microsoft/Windows-classic-samples#343).
//
// This program never calls either of them: process loopback is not tied to
// an endpoint, so the format is stated rather than negotiated, and the one
// documented Windows 10 failure is therefore not on our path.
//
// So support is answered by *trying it*. On success this prints READY (see
// kReadyLine) and starts streaming; when activation is refused it exits with
// EXIT_UNSUPPORTED, and the shell falls back to Electron's own loopback
// capture. A version check would only have been a guess at that answer, and
// on this API a wrong guess disables the feature for machines that can run
// it perfectly well.

#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <avrt.h>
#include <objbase.h>

#include <fcntl.h>
#include <io.h>
#include <stdio.h>

#include <atomic>
#include <condition_variable>
#include <deque>
#include <mutex>
#include <thread>
#include <vector>

// Exit codes the shell distinguishes. Anything else is an unexpected
// failure and is treated like a crash.
static const int EXIT_OK = 0;
static const int EXIT_BAD_ARGS = 2;
// The OS does not have process loopback, or refused the activation.
// Recoverable: the caller uses Electron's own loopback instead.
static const int EXIT_UNSUPPORTED = 3;

// Printed on stderr once the capture is actually running. This is the
// shell's "it works here" signal, and the reason no version check is needed
// on either side: activation either succeeds and this appears, or it fails
// and the process exits. Sent on stderr rather than stdout to keep the PCM
// stream on stdout free of anything that is not audio.
static const wchar_t* kReadyLine = L"READY\n";

// The one format this tool speaks. Fixed rather than negotiated because the
// consumer is a Web Audio graph that wants 48 kHz stereo anyway, and process
// loopback lets us *ask* for a format instead of accepting an endpoint's mix
// format — the capture is not tied to a device at all. 16-bit rather than
// float32 halves what crosses two IPC hops per chunk, and the conversion on
// the other side is one multiply.
static const WORD kChannels = 2;
static const DWORD kSampleRate = 48000;
static const WORD kBitsPerSample = 16;

// How much audio may pile up between the capture thread and the thread that
// writes to stdout. The reader is Electron's main process, which is
// occasionally busy; without a queue a hiccup there would stall the capture
// thread and show up as a glitch in the stream. Half a second is far more
// than a healthy reader ever needs, so reaching this limit means the reader
// is gone or wedged — at which point the *oldest* audio is what to drop,
// since this is a live stream and stale samples have no value.
static const size_t kMaxQueuedBytes =
    (kSampleRate * kChannels * (kBitsPerSample / 8)) / 2;

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

// ActivateAudioInterfaceAsync answers through a COM callback rather than
// returning the interface, so this object exists only to be signalled. It
// lives on the caller's stack for the duration of the wait, which is why
// Release() never deletes anything.
class ActivationHandler : public IActivateAudioInterfaceCompletionHandler,
                          public IAgileObject {
 public:
  ActivationHandler() : done_(CreateEventW(nullptr, TRUE, FALSE, nullptr)) {}

  ~ActivationHandler() {
    if (client_) client_->Release();
    if (done_) CloseHandle(done_);
  }

  // Blocks until ActivateCompleted has run. INFINITE is safe here: the API
  // contract is that the handler is always invoked, success or failure.
  HRESULT Wait(IAudioClient** out) {
    if (!done_) return E_FAIL;
    WaitForSingleObject(done_, INFINITE);
    if (FAILED(result_)) return result_;
    *out = client_;
    client_ = nullptr;  // ownership moves to the caller
    return S_OK;
  }

  HANDLE event() const { return done_; }

  STDMETHODIMP ActivateCompleted(
      IActivateAudioInterfaceAsyncOperation* operation) override {
    HRESULT activate_hr = S_OK;
    IUnknown* unknown = nullptr;
    HRESULT hr = operation->GetActivateResult(&activate_hr, &unknown);
    // Two results to check, not one: the call can succeed while the
    // activation it reports failed. Collapsing them loses exactly the error
    // we care about on an unsupported Windows build.
    if (SUCCEEDED(hr)) hr = activate_hr;
    if (SUCCEEDED(hr) && unknown) {
      hr = unknown->QueryInterface(__uuidof(IAudioClient),
                                   reinterpret_cast<void**>(&client_));
    }
    if (unknown) unknown->Release();
    result_ = hr;
    SetEvent(done_);
    return S_OK;
  }

  STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (riid == __uuidof(IUnknown) ||
        riid == __uuidof(IActivateAudioInterfaceCompletionHandler)) {
      *ppv = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
    } else if (riid == __uuidof(IAgileObject)) {
      *ppv = static_cast<IAgileObject*>(this);
    } else {
      *ppv = nullptr;
      return E_NOINTERFACE;
    }
    AddRef();
    return S_OK;
  }

  STDMETHODIMP_(ULONG) AddRef() override { return ++refs_; }
  // Deliberately does not delete: this object is stack-allocated by wmain.
  STDMETHODIMP_(ULONG) Release() override { return --refs_; }

 private:
  HANDLE done_ = nullptr;
  IAudioClient* client_ = nullptr;
  HRESULT result_ = E_UNEXPECTED;
  std::atomic<ULONG> refs_{1};
};

static HRESULT ActivateExcludingProcessTree(DWORD pid, IAudioClient** out) {
  AUDIOCLIENT_ACTIVATION_PARAMS params = {};
  params.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  params.ProcessLoopbackParams.TargetProcessId = pid;
  // The whole reason this program exists. INCLUDE would capture only GoLive;
  // EXCLUDE captures everything *but* GoLive, which is what a screen share
  // carrying system audio should contain.
  params.ProcessLoopbackParams.ProcessLoopbackMode =
      PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;

  PROPVARIANT activate_params = {};
  activate_params.vt = VT_BLOB;
  activate_params.blob.cbSize = sizeof(params);
  activate_params.blob.pBlobData = reinterpret_cast<BYTE*>(&params);

  ActivationHandler handler;
  if (!handler.event()) return E_FAIL;

  IActivateAudioInterfaceAsyncOperation* operation = nullptr;
  HRESULT hr = ActivateAudioInterfaceAsync(
      VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient),
      &activate_params, &handler, &operation);
  if (operation) operation->Release();
  if (FAILED(hr)) return hr;

  return handler.Wait(out);
}

// ---------------------------------------------------------------------------
// stdout writer
// ---------------------------------------------------------------------------

// Decouples the capture thread from the pipe. See kMaxQueuedBytes.
class PcmSink {
 public:
  void Push(const BYTE* data, size_t bytes) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (closed_) return;
    queued_bytes_ += bytes;
    chunks_.emplace_back(data, data + bytes);
    while (queued_bytes_ > kMaxQueuedBytes && !chunks_.empty()) {
      queued_bytes_ -= chunks_.front().size();
      chunks_.pop_front();
    }
    ready_.notify_one();
  }

  void Close() {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      closed_ = true;
    }
    ready_.notify_all();
  }

  // Returns when the sink is closed and drained, or when writing to stdout
  // fails — which is how this process learns the shell is gone. A broken
  // pipe is a normal end of life here, not an error worth reporting.
  void Run() {
    for (;;) {
      std::vector<BYTE> chunk;
      {
        std::unique_lock<std::mutex> lock(mutex_);
        ready_.wait(lock, [&] { return closed_ || !chunks_.empty(); });
        if (chunks_.empty()) return;  // closed and drained
        chunk.swap(chunks_.front());
        chunks_.pop_front();
        queued_bytes_ -= chunk.size();
      }
      if (fwrite(chunk.data(), 1, chunk.size(), stdout) != chunk.size()) return;
      fflush(stdout);
    }
  }

 private:
  std::mutex mutex_;
  std::condition_variable ready_;
  std::deque<std::vector<BYTE>> chunks_;
  size_t queued_bytes_ = 0;
  bool closed_ = false;
};

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

struct CaptureContext {
  IAudioCaptureClient* capture = nullptr;
  HANDLE buffer_ready = nullptr;
  HANDLE quit = nullptr;
  PcmSink* sink = nullptr;
  WORD block_align = kChannels * (kBitsPerSample / 8);
};

static void CaptureLoop(CaptureContext* ctx) {
  // Without this the capture thread is scheduled like any other and drops
  // packets under load — which is audible as clicks in the shared audio.
  DWORD task_index = 0;
  HANDLE mm_task = AvSetMmThreadCharacteristicsW(L"Pro Audio", &task_index);

  HANDLE waits[2] = {ctx->quit, ctx->buffer_ready};
  bool running = true;
  // Reused across packets so the steady state allocates nothing.
  std::vector<BYTE> silence;

  while (running) {
    DWORD wait = WaitForMultipleObjects(2, waits, FALSE, INFINITE);
    if (wait != WAIT_OBJECT_0 + 1) break;  // quit signalled, or the wait failed

    for (;;) {
      BYTE* data = nullptr;
      UINT32 frames = 0;
      DWORD flags = 0;
      HRESULT hr =
          ctx->capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr);
      if (hr == AUDCLNT_S_BUFFER_EMPTY) break;
      if (FAILED(hr)) {
        // AUDCLNT_E_DEVICE_INVALIDATED lands here when the default endpoint
        // changes or a device is unplugged. Ending the process is the right
        // response: the shell restarts it, which re-activates against
        // whatever the system is using now.
        running = false;
        break;
      }

      const size_t bytes = static_cast<size_t>(frames) * ctx->block_align;
      if (bytes > 0) {
        if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
          // The pointer is not meaningful when this flag is set, so the
          // silence has to be synthesized rather than copied. Sending it at
          // all, instead of skipping the packet, keeps the reader's jitter
          // buffer at a steady fill through quiet stretches.
          if (silence.size() < bytes) silence.assign(bytes, 0);
          ctx->sink->Push(silence.data(), bytes);
        } else {
          ctx->sink->Push(data, bytes);
        }
      }
      ctx->capture->ReleaseBuffer(frames);
    }
  }

  if (mm_task) AvRevertMmThreadCharacteristics(mm_task);
  ctx->sink->Close();
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

// The shell closing our stdin is the shutdown signal. It is more reliable
// than waiting to be killed: a TerminateProcess leaves WASAPI to clean up
// after the fact, while this stops the client properly. It also covers the
// case where the shell dies without getting to kill anything.
static void WatchStdin(HANDLE quit) {
  HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
  char scratch[64];
  DWORD read = 0;
  while (in != INVALID_HANDLE_VALUE &&
         ReadFile(in, scratch, sizeof(scratch), &read, nullptr) && read > 0) {
    // Nothing is ever sent on stdin; only the EOF matters.
  }
  SetEvent(quit);
}

int wmain(int argc, wchar_t** argv) {
  DWORD exclude_pid = 0;
  for (int i = 1; i < argc; i++) {
    if (wcscmp(argv[i], L"--exclude-pid") == 0 && i + 1 < argc) {
      exclude_pid = static_cast<DWORD>(_wtoi64(argv[++i]));
    }
  }
  if (exclude_pid == 0) {
    fwprintf(stderr, L"usage: golive-audiocap --exclude-pid <pid>\n");
    return EXIT_BAD_ARGS;
  }

  // Raw PCM down a pipe: without this the CRT would helpfully turn every
  // 0x0A byte in the audio into 0x0D 0x0A and corrupt the stream.
  _setmode(_fileno(stdout), _O_BINARY);

  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) return EXIT_UNSUPPORTED;

  IAudioClient* client = nullptr;
  hr = ActivateExcludingProcessTree(exclude_pid, &client);
  if (FAILED(hr)) {
    // The expected failure on Windows 10, where this activation type does
    // not exist. Reported on stderr so the shell's log says why rather than
    // only showing an exit code.
    fwprintf(stderr, L"process loopback activation failed: 0x%08lX\n", hr);
    CoUninitialize();
    return EXIT_UNSUPPORTED;
  }

  WAVEFORMATEX format = {};
  format.wFormatTag = WAVE_FORMAT_PCM;
  format.nChannels = kChannels;
  format.nSamplesPerSec = kSampleRate;
  format.wBitsPerSample = kBitsPerSample;
  format.nBlockAlign = format.nChannels * format.wBitsPerSample / 8;
  format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;
  format.cbSize = 0;

  // AUTOCONVERTPCM lets the audio engine resample whatever the excluded mix
  // actually is into the format above, which is why this can state a fixed
  // 48 kHz stereo rather than negotiating one. SRC_DEFAULT_QUALITY is the
  // documented companion flag; without it the conversion is the cheap one.
  hr = client->Initialize(
      AUDCLNT_SHAREMODE_SHARED,
      AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK |
          AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM |
          AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
      // 200 ms of engine buffer, in 100 ns units. Generous on purpose: the
      // reader is a Node process, and underrunning here costs audio, while
      // the latency this adds is bounded by how fast we drain it rather than
      // by the buffer size.
      2000000, 0, &format, nullptr);
  if (FAILED(hr)) {
    fwprintf(stderr, L"IAudioClient::Initialize failed: 0x%08lX\n", hr);
    client->Release();
    CoUninitialize();
    return EXIT_UNSUPPORTED;
  }

  IAudioCaptureClient* capture = nullptr;
  hr = client->GetService(__uuidof(IAudioCaptureClient),
                          reinterpret_cast<void**>(&capture));
  if (FAILED(hr)) {
    client->Release();
    CoUninitialize();
    return EXIT_UNSUPPORTED;
  }

  HANDLE buffer_ready = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  HANDLE quit = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  client->SetEventHandle(buffer_ready);

  PcmSink sink;
  CaptureContext ctx;
  ctx.capture = capture;
  ctx.buffer_ready = buffer_ready;
  ctx.quit = quit;
  ctx.sink = &sink;

  hr = client->Start();
  if (FAILED(hr)) {
    fwprintf(stderr, L"IAudioClient::Start failed: 0x%08lX\n", hr);
    capture->Release();
    client->Release();
    CoUninitialize();
    return EXIT_UNSUPPORTED;
  }

  // Everything that could have refused has now succeeded, so the caller can
  // stop waiting and commit to this path. Flushed explicitly because stderr
  // is a pipe here, not a console, and the caller is blocked on this line.
  fputws(kReadyLine, stderr);
  fflush(stderr);

  std::thread stdin_watch(WatchStdin, quit);
  stdin_watch.detach();
  std::thread capture_thread(CaptureLoop, &ctx);

  // Runs until the capture thread closes the sink, or until stdout breaks —
  // whichever comes first. Both mean the same thing: stop.
  sink.Run();
  SetEvent(quit);
  capture_thread.join();

  client->Stop();
  capture->Release();
  client->Release();
  CloseHandle(buffer_ready);
  CloseHandle(quit);
  CoUninitialize();
  return EXIT_OK;
}
