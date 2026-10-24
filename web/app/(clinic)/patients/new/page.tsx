import type { Metadata } from "next";
import { RegisterScreen } from "./register-screen";

export const metadata: Metadata = { title: "New patient" };

const UUID = /^[0-9a-f-]{36}$/;

export default async function NewPatientPage({ searchParams }: { searchParams: Promise<{ request?: string; lead?: string }> }) {
  const { request, lead } = await searchParams;
  return (
    <RegisterScreen
      requestId={request && UUID.test(request) ? request : null}
      leadId={!request && lead && UUID.test(lead) ? lead : null}
    />
  );
}
