import { useThreadRowAvatarSetting } from "../sidebar/ThreadRowParts";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/** Personal build: thread rows can lead with the project's icon. */
export function ThreadRowAvatarSettingRow() {
  const [shown, setShown] = useThreadRowAvatarSetting();
  return (
    <SettingsRow
      {...searchableSetting("thread-row-icons")}
      description="Show the project's icon at the start of each row in the thread list."
      resetAction={
        shown ? <SettingResetButton label="project icons" onClick={() => setShown(false)} /> : null
      }
      control={
        <Switch
          checked={shown}
          onCheckedChange={(checked) => setShown(Boolean(checked))}
          aria-label="Project icons"
        />
      }
    />
  );
}
