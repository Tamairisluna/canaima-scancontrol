import { LoginScreen } from "@/app/login/login-screen";

type LoginPageProps = {
  searchParams: Promise<{ error?: string | string[] }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  return <LoginScreen authCallbackError={params.error === "auth_callback"} />;
}
