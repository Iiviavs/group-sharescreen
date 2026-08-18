import { WatchRoom } from "./WatchRoom";

export default async function WatchPage(props: PageProps<"/watch/[handle]">) {
  const { handle } = await props.params;
  return <WatchRoom handle={handle} />;
}
