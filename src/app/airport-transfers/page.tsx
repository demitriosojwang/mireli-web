import { redirect } from "next/navigation";

export default function AirportTransfersRedirect() {
  redirect("/?type=airport&transfer=1");
}
