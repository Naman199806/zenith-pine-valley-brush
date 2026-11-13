import { createFileRoute } from "@tanstack/react-router";
import { Research } from "@/components/apex/research";

export const Route = createFileRoute("/research")({ component: Research });
