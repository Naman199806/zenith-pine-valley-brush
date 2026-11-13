import { createFileRoute } from "@tanstack/react-router";
import { Terminal } from "@/components/apex/terminal";

export const Route = createFileRoute("/terminal")({ component: Terminal });
