import { Button, EmptyState } from "@polaris/ui";
import { Link2Off } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col items-center justify-center px-5">
      <EmptyState
        icon={<Link2Off />}
        title="This link doesn't go anywhere"
        description="It may have expired, or part of it went missing. Ask whoever sent it for a new one."
        action={
          <Button asChild variant="white" size="lg" shape="rounded">
            <Link href="/">Go to Polaris</Link>
          </Button>
        }
      />
    </main>
  );
}
