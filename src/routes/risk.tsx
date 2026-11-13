import { createFileRoute } from "@tanstack/react-router";
import { Risk } from "@/components/apex/risk";

export const Route = createFileRoute("/risk")({ component: Risk });
