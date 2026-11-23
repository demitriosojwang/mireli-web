"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LoginScreen } from "@/components/app/login-screen";
import { useMe } from "@/lib/client";

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const destination = next && /^\/(?![\/\\])/.test(next) && !/[\\\s]/.test(next) ? next : "/";
  const { refresh } = useMe();

  return (
    <LoginScreen
      onDone={() => {
        refresh();
        router.replace(destination);
      }}
    />
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
