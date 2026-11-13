import { createFileRoute } from "@tanstack/react-router";
import { Ops } from "@/components/apex/ops";

export const Route = createFileRoute("/ops")({ component: Ops });
