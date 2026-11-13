import { createFileRoute } from "@tanstack/react-router";
import { Markets } from "@/components/apex/markets";

export const Route = createFileRoute("/markets")({ component: Markets });
