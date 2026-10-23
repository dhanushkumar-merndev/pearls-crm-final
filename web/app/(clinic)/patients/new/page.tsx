import type { Metadata } from "next";
import { RegisterScreen } from "./register-screen";

export const metadata: Metadata = { title: "New patient" };

export default async function NewPatientPage({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const { request } = await searchParams;
  return <RegisterScreen requestId={request && /^[0-9a-f-]{36}$/.test(request) ? request : null} />;
}
