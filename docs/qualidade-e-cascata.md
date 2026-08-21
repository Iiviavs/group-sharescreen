# Qualidade por espectador e cascata

Como a transmissão decide o que enviar para cada pessoa, e quando (raramente)
pede ajuda a participantes para retransmitir.

## O princípio

Numa sala de 30 pessoas a grade dá ~320×216 px por tile. Mandar 1080p para
esse tile joga fora ~95% dos pixels codificados — na CPU **e** no upload de
quem transmite. A regra central é:

> Cada espectador recebe a qualidade que a tela dele realmente usa.

Medido contra o comportamento anterior ("todo mundo recebe o preset"): **~6×
menos upload e ~7,8× menos encode** para o mesmo resultado visível. O encode
cai mais que a banda porque custo de encoder acompanha pixels/segundo — e era
exatamente esse o muro que impedia uma sala grande em malha.

Consequência prática: **um desktop comum serve 30 pessoas em malha direta,
sem cascata nenhuma**, mesmo com jogo a 60fps. A cascata é rota de exceção.

## Módulos

| Arquivo | Responsabilidade |
|---|---|
| `lib/videoQuality.ts` | Tiers, custo (kbps e Mpx/s), tamanho renderizado → tier |
| `lib/qualityNegotiation.ts` | Espectador informa o tamanho do tile ao transmissor |
| `lib/peerQualityController.ts` | Aplica tier + controle de congestionamento por peer |
| `lib/mediaStats.ts` | **Uma** passada de `getStats()` para tudo; orçamento de encode |
| `lib/topologyPlanner.ts` | Decide malha direta vs cascata (função pura, testada) |
| `lib/useMeshTopology.ts` | Mede capacidade, troca com peers, roda o planejador |
| `lib/relayLink.ts` | Executa a retransmissão (desligado por padrão) |

Nada disso exigiu mudança no backend: o servidor repassa o `data` de um
`signal` de forma opaca, então os tipos novos (`quality`, `capacity`,
`relay-assign`) trafegam sem alteração na API.

## Decisões que valem saber

**Framerate não é decidido por tamanho de tile.** Diminuir a janela não pode
significar "quero 15fps". Tamanho escolhe resolução; framerate cai só sob
pressão (congestionamento ou penalidade de profundidade na árvore).

**Estado de congestionamento sobrevive a mudanças de qualidade.** Antes, todo
ajuste de qualidade reiniciava o monitor de cada peer — e como ele também
rodava a cada mudança no número de pessoas, um espectador em link ruim voltava
ao bitrate cheio sempre que alguém entrava ou saía, e nunca convergia. Agora
`setTier()` mexe só no alvo e preserva a razão aprendida.

**Um timer de stats, não 29.** Antes era um `setInterval` + `getStats()` por
peer. Agora é uma passada compartilhada, com janela deslizante acima de 12
senders para o custo por tick não crescer com a sala.

**`contentHint` virou escolha do usuário.** Estava fixo em `"detail"` para
toda tela, o que combinado com `maintain-resolution` manda o encoder sacrificar
quadros para preservar nitidez — certo para código, errado para jogo a 60fps.
Agora há o seletor "Texto / código" vs "Vídeo / jogo", que muda `contentHint`,
`degradationPreference` e a ordem de codecs de uma vez.

**Custo do conteúdo é medido, não presumido.** O mesmo "1080p60" custa ~1/8
para um IDE estático e ~1,2× para um jogo. O planejador usa o bitrate real
observado.

## Cascata

Desligada por padrão. Ligue com `NEXT_PUBLIC_RELAY_ENABLED=true`.

O motivo de estar desligada: **navegador não faz passthrough de RTP**. As
WebRTC Encoded Transforms existem, mas repasse entre PeerConnections não é
coberto pela spec (casamento de codec, reescrita de SSRC/timestamp e
propagação de PLI ficam indefinidos). Então cada salto é decode + encode
completos: ~120–220ms e uma geração de perda de qualidade, gastando CPU e
upload de um participante.

O que **não** está validado em campo é churn: quando um relay fecha a aba, a
subárvore congela até ser re-parenteada. `RelayLink` detecta a fonte parada em
~1,5s e avisa os filhos, mas isso precisa ser exercitado numa sala real antes
de ligar em produção. Uma subárvore congelada é pior que um transmissor um
pouco sobrecarregado.

Profundidade é limitada a 3 — além disso o planejador **rebaixa qualidade em
vez de aprofundar**.

## Verificar

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Para medir codec/`contentHint` no conteúdo e na máquina reais, abra
`analise/codec-diagnostico.html` no Chrome e compartilhe a tela mais pesada
que tiver. Se `VP9/detail` aparecer em vermelho e `VP9/motion` em verde, o
`contentHint` estava sabotando o 60fps. A coluna Mbps é o custo real do
conteúdo.

## Calibrar

`lib/mediaStats.ts` semeia o orçamento de encode a partir de
`hardwareConcurrency` (~100 Mpx/s por núcleo) e corrige para baixo quando o
encoder reporta limitação de CPU. É a única realimentação confiável — contagem
de núcleos não diz nada sobre qualidade do núcleo, folga térmica ou encoder de
hardware. Se as medidas de campo mostrarem que o palpite inicial erra muito,
`seedEncodeBudget()` é o botão a girar.

Margens do planejador em `lib/topologyPlanner.ts`: `UPLOAD_HEADROOM` (0,75) e
`ENCODE_HEADROOM` (0,8). Nunca planeje contra 100% do medido — estimativa de
banda passa do ponto, e encoder no teto exato derruba quadros.
