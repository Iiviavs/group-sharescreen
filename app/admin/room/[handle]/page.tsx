import { AdminRoomViewer } from "./AdminRoomViewer";

export default async function AdminRoomPage(props: PageProps<"/admin/room/[handle]">) {
  const { handle } = await props.params;
  return <AdminRoomViewer handle={handle} />;
}
