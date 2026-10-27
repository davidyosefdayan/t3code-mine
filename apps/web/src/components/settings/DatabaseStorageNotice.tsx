import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { formatBytes } from "../../lib/formatBytes";
import { environmentAtomList, environmentIdsKey } from "../../state/environmentAtomList";
import { serverEnvironment } from "../../state/server";
import { Button } from "../ui/button";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const DismissedEnvironmentIds = Schema.Array(Schema.String);
const databaseStatusesAtom = environmentAtomList("web-database-storage-statuses", (environmentId) =>
  serverEnvironment.databaseStorage({ environmentId, input: {} }),
);

/** Suggests `t3 doctor` on every machine whose database still holds at least 1 GiB of freed pages. */
export function DatabaseStorageNotice({
  environments,
}: {
  environments: ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly label: string }>;
}) {
  const recommendations = useAtomValue(
    serverEnvironment.databaseCompactionRecommendations(
      JSON.stringify(environments.map((environment) => environment.environmentId)),
    ),
  );
  const [dismissed, setDismissed] = useLocalStorage(
    "database-storage-notice-dismissed",
    [],
    DismissedEnvironmentIds,
  );
  const { copyToClipboard } = useCopyToClipboard({ target: "command" });
  // Personal build: the database's size and free space are always shown.
  const statuses = useAtomValue(
    databaseStatusesAtom(
      environmentIdsKey(environments.map((environment) => environment.environmentId)),
    ),
  ).flatMap((result, index) =>
    result._tag === "Success" && result.value !== null
      ? [{ environment: environments[index]!, status: result.value }]
      : [],
  );
  const visible = recommendations.filter(
    (recommendation) => !dismissed.includes(recommendation.environmentId),
  );
  if (visible.length === 0 && statuses.length === 0) return null;
  return (
    <SettingsSection id="storage-database" title="Database">
      {statuses.map(({ environment, status }) => (
        <SettingsRow
          key={`size:${environment.environmentId}`}
          title={environments.length > 1 ? `Size on ${environment.label}` : "Size"}
          description={
            status.incrementalVacuumEnabled
              ? "Space freed inside the database returns to disk automatically, a little every minute."
              : "Space freed inside the database stays in the file until you run the reclaim command once. After that, freed space returns to disk automatically."
          }
          control={
            <span className="text-xs text-muted-foreground">
              {formatBytes(status.databaseBytes)}, {formatBytes(status.reclaimableBytes)} free
            </span>
          }
        />
      ))}
      {visible.length > 0 && (
        <SettingsRow
          title="Reclaim freed database space"
          description="Old history is cleaned up automatically, but these databases still hold the freed space. Run the command on each machine to return it to disk; it pauses and restarts the background service. Quit the desktop app first if it hosts the environment."
        />
      )}
      {visible.map(({ environmentId, status }) => (
        <SettingsRow
          key={environmentId}
          title={`${(status.reclaimableBytes / 1024 ** 3).toFixed(1)} GiB on ${
            environments.find((environment) => environment.environmentId === environmentId)
              ?.label ?? environmentId
          }`}
          description={<code className="select-text break-all">{status.compactCommand}</code>}
          control={
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant="outline"
                size="xs"
                onClick={() => copyToClipboard(status.compactCommand, undefined)}
              >
                Copy command
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setDismissed((current) => [...current, environmentId])}
              >
                Dismiss
              </Button>
            </div>
          }
        />
      ))}
    </SettingsSection>
  );
}
