import type { Metadata } from "next";
import { RegisterScreen } from "./register-screen";

export const metadata: Metadata = { title: "New patient" };

const UUID = /^[0-9a-f-]{36}$/;
const E164 = /^\+[1-9][0-9]{7,14}$/;

export default async function NewPatientPage({ searchParams }: { searchParams: Promise<{ request?: string; lead?: string; phone?: string }> }) {
  const { request, lead, phone } = await searchParams;
  return (
    <RegisterScreen
      requestId={request && UUID.test(request) ? request : null}
      leadId={!request && lead && UUID.test(lead) ? lead : null}
      phone={phone && E164.test(phone) ? phone : null}
    />
  );
}
