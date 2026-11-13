import { createFileRoute } from "@tanstack/react-router";
import { Portfolio } from "@/components/apex/portfolio";

export const Route = createFileRoute("/portfolio")({ component: Portfolio });
