import { auth } from "@clerk/nextjs/server";
import { Suspense } from "react";

export default function WorkspacePage() {
  return (
    <div className="px-4 py-3">
      <Suspense>
        <OrganizationName />
      </Suspense>
    </div>
  );
}

// Comes off the session token's claims, so it is in the server-rendered HTML and
// nothing asks Clerk a question at request time.
async function OrganizationName() {
  const { sessionClaims } = await auth.protect();
  return <h1 className="font-medium">{sessionClaims.org_name}</h1>;
}
