import { createFileRoute } from "@tanstack/react-router";

import { ReadAloudSettings } from "../components/settings/ReadAloudSettings";

function SettingsReadAloudRoute() {
  return <ReadAloudSettings />;
}

export const Route = createFileRoute("/_chat/settings/read-aloud")({
  component: SettingsReadAloudRoute,
});
