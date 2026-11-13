import { createFileRoute } from "@tanstack/react-router";
import { Integrations } from "@/components/apex/integrations";

export const Route = createFileRoute("/integrations")({ component: Integrations });
