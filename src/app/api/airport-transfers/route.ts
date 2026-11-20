import { airportPassengerOverview, cancelPassengerAirportTransfer, createAirportTransfer } from "@/lib/airport-transfers";
import { DriverError, text } from "@/lib/driver/errors";
import { getPassengerSession } from "@/lib/session";

function response(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function handle(req: Request) {
  try {
    const session = await getPassengerSession();
    if (!session) return response({ error: "Sign in to manage your airport transfers." }, 401);
    if (req.method === "GET") return response(await airportPassengerOverview(session.id));
    if (!req.headers.get("content-type")?.startsWith("application/json")) {
      return response({ error: "Send an airport transfer request as JSON." }, 415);
    }
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return response({ error: "Invalid request." }, 400);
    if (req.method === "PUT") {
      if (body.action !== "cancel") return response({ error: "Invalid transfer action." }, 400);
      return response(await cancelPassengerAirportTransfer(session.id, text(body.id, "Transfer", 1, 80)));
    }
    return response({ transfer: await createAirportTransfer(session.id, body) }, 201);
  } catch (error) {
    if (error instanceof DriverError) return response({ error: error.message }, error.status);
    return response({ error: "Airport transfers are temporarily unavailable." }, 503);
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
