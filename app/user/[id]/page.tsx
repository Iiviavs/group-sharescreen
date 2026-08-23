import type { Metadata } from "next";
import { UserProfileClient } from "./UserProfileClient";

export async function generateMetadata(
  props: PageProps<"/user/[id]">
): Promise<Metadata> {
  const { id } = await props.params;
  return {
    title: `Perfil de ${id}`,
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default async function UserProfilePage(props: PageProps<"/user/[id]">) {
  const { id } = await props.params;
  return <UserProfileClient id={id} />;
}
