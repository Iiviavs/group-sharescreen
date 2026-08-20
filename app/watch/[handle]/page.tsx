import type { Metadata } from "next";
import { WatchRoom } from "./WatchRoom";

export async function generateMetadata(
  props: PageProps<"/watch/[handle]">
): Promise<Metadata> {
  const { handle } = await props.params;
  return {
    title: `Sala ${handle}`,
    description: `Entre na sala "${handle}" no GoLive para transmitir ou assistir tela em grupo, ao vivo e sem cadastro.`,
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default async function WatchPage(props: PageProps<"/watch/[handle]">) {
  const { handle } = await props.params;
  return <WatchRoom handle={handle} />;
}
