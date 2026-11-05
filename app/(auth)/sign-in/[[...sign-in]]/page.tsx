import { SignIn } from "@clerk/nextjs";
import { Suspense } from "react";

// Clerk renders whichever sign-in methods are enabled in its dashboard, and all
// of them finish at the same redirect. Adding or removing one is config only.
export default function SignInPage() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}
