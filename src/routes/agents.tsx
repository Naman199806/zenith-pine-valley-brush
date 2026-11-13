import { createFileRoute } from "@tanstack/react-router";
import { Agents } from "@/components/apex/agents";

export const Route = createFileRoute("/agents")({ component: Agents });
