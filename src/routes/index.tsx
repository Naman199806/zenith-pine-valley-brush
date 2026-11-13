import { createFileRoute } from "@tanstack/react-router";
import { Overview } from "@/components/apex/overview";

export const Route = createFileRoute("/")({ component: Overview });
