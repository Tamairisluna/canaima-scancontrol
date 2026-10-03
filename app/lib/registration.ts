import { getRegistrationDirectoryClient } from "./supabase";

export type RegistrationStore = { id: string; name: string; slug: string; city?: string };
export const registrationLoadMessage = "No se pudieron cargar las tiendas. Comprueba tu conexión y pulsa Reintentar.";

type DirectoryClient = Pick<ReturnType<typeof getRegistrationDirectoryClient>, "rpc">;

export async function loadRegistrationStores(client: DirectoryClient = getRegistrationDirectoryClient()): Promise<RegistrationStore[]> {
  // Retry a transient request once; never change store permissions or use a
  // device's cached session to read the public registration directory.
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const { data, error } = await client.rpc("registration_stores_by_city").abortSignal(controller.signal);
      if (!error && Array.isArray(data)) {
        if (!data.length) throw new Error("No hay tiendas disponibles para el registro. Contacta al encargado.");
        if (data.every((store) => store && typeof store.id === "string" && typeof store.name === "string" && typeof store.slug === "string" && (store.city == null || typeof store.city === "string"))) {
          return data as RegistrationStore[];
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message === "No hay tiendas disponibles para el registro. Contacta al encargado.") throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(registrationLoadMessage);
}
