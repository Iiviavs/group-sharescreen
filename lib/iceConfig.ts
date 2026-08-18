const TURN_URLS = process.env.NEXT_PUBLIC_TURN_URLS || "";
const TURN_USERNAME = process.env.NEXT_PUBLIC_TURN_USERNAME || "";
const TURN_CREDENTIAL = process.env.NEXT_PUBLIC_TURN_CREDENTIAL || "";

export const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: TURN_URLS.split(","),
      username: TURN_USERNAME,
      credential: TURN_CREDENTIAL,
    },
  ],
};
