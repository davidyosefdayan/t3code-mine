import type { EnvironmentId, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { useState } from "react";

import { useProjects } from "../../state/entities";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { toSkillName } from "./skillsCatalog";

export interface SkillCreateTarget {
  readonly instanceId: ProviderInstanceId;
  readonly driver: ProviderDriverKind;
  readonly providerName: string;
  readonly accentColor: string | undefined;
}

export interface SkillCreateRequest {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly instanceIds: readonly [ProviderInstanceId, ...ProviderInstanceId[]];
  readonly projectRoot: string | undefined;
}

const PERSONAL = "";

/**
 * Writing a skill by hand: name, when to use it, the instructions, which
 * providers load it, and whether it is personal or belongs to a project.
 */
export function SkillCreateDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  environmentId: EnvironmentId;
  targets: ReadonlyArray<SkillCreateTarget>;
  initialProjectRoot: string | undefined;
  onCreate: (request: SkillCreateRequest) => Promise<boolean>;
}) {
  const projects = useProjects().filter((project) => project.environmentId === props.environmentId);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(props.targets.map((target) => target.instanceId)),
  );
  const [projectRoot, setProjectRoot] = useState(props.initialProjectRoot ?? PERSONAL);
  const [creating, setCreating] = useState(false);
  const name = toSkillName(title);
  const instanceIds = props.targets
    .filter((target) => selected.has(target.instanceId))
    .map((target) => target.instanceId);
  const canCreate =
    name.length > 0 && description.trim().length > 0 && instanceIds.length > 0 && !creating;

  const submit = async () => {
    const [first, ...rest] = instanceIds;
    if (!canCreate || first === undefined) return;
    setCreating(true);
    const created = await props.onCreate({
      name,
      description: description.trim(),
      instructions,
      instanceIds: [first, ...rest],
      projectRoot: projectRoot === PERSONAL ? undefined : projectRoot,
    });
    setCreating(false);
    if (created) props.onOpenChange(false);
  };

  return (
    <Dialog open={props.open} onOpenChange={(open) => !creating && props.onOpenChange(open)}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create a skill</DialogTitle>
          <DialogDescription>
            Instructions an agent loads when your request matches the description.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void submit();
              }
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="skill-name">Name</Label>
              <Input
                id="skill-name"
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
                placeholder="Weekly status report"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                {name ? (
                  <>
                    Runs as <code className="font-mono text-foreground/80">/{name}</code>
                  </>
                ) : (
                  "Lowercase words joined by hyphens, used as the command and folder name."
                )}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="skill-description">Description</Label>
              <Textarea
                id="skill-description"
                value={description}
                onChange={(event) => setDescription(event.currentTarget.value)}
                placeholder="Write weekly status reports from recent work. Use when asked for updates or progress summaries."
                rows={2}
              />
              <p className="text-xs text-muted-foreground">
                Agents read this to decide when to use the skill, so say when, not just what.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="skill-instructions">Instructions</Label>
              <Textarea
                id="skill-instructions"
                value={instructions}
                onChange={(event) => setInstructions(event.currentTarget.value)}
                placeholder="Summarize my recent work in three sections: wins, blockers, and next steps…"
                rows={10}
                variant="code"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1.5 text-sm font-medium">Available in</legend>
                {props.targets.map((target) => (
                  <label key={target.instanceId} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selected.has(target.instanceId)}
                      onCheckedChange={(checked) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (checked) next.add(target.instanceId);
                          else next.delete(target.instanceId);
                          return next;
                        })
                      }
                    />
                    <ProviderInstanceIcon
                      driverKind={target.driver}
                      displayName={target.providerName}
                      accentColor={target.accentColor}
                      className="size-4"
                      iconClassName="size-4"
                      showBadge={false}
                    />
                    {target.providerName}
                  </label>
                ))}
                {instanceIds.length > 1 ? (
                  <p className="text-xs text-muted-foreground">
                    One copy, linked for each provider, so an edit updates all of them.
                  </p>
                ) : null}
              </fieldset>
              <div className="flex flex-col gap-1.5">
                <Label>Where</Label>
                <Select
                  value={projectRoot}
                  onValueChange={(value) => setProjectRoot(value ?? PERSONAL)}
                >
                  <SelectTrigger aria-label="Where to save the skill">
                    <SelectValue>
                      {projectRoot === PERSONAL
                        ? "Personal, in every project"
                        : (projects.find((project) => project.workspaceRoot === projectRoot)
                            ?.title ?? projectRoot)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value={PERSONAL}>Personal, in every project</SelectItem>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.workspaceRoot}>
                        <span className="flex items-center gap-2">
                          <ProjectFavicon project={project} className="size-3.5" />
                          {project.title}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {projectRoot === PERSONAL
                    ? "Saved in your own skills folders."
                    : "Saved in the project, so it travels with the repository."}
                </p>
              </div>
            </div>
          </form>
        </DialogPanel>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => props.onOpenChange(false)}
            disabled={creating}
          >
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={() => void submit()} disabled={!canCreate}>
            {creating ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
