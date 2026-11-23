import { redirect } from "next/navigation";

export default function AirportsRedirect() {
  redirect("/?type=airport");
}
