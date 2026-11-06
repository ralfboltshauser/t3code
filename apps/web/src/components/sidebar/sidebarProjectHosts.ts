import type { ConnectionCatalogEntry } from "@t3tools/client-runtime/connection";
import type { EnvironmentId, EnvironmentMachineKind } from "@t3tools/contracts";

import { isDesktopLocalConnectionTarget } from "../../connection/desktopLocal";

function hostAccent(hue: number) {
  return `light-dark(oklch(0.48 0.12 ${hue}), oklch(0.78 0.1 ${hue}))`;
}

function environmentAccent(environmentId: EnvironmentId) {
  let hash = 2166136261;
  for (let index = 0; index < environmentId.length; index++) {
    hash = Math.imul(hash ^ environmentId.charCodeAt(index), 16777619);
  }
  const hue = (hash >>> 0) % 100;
  return hostAccent(hue < 60 ? 190 + hue : 300 + hue - 60);
}

export function resolveSidebarProjectHosts(input: {
  readonly members: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly environmentLabel: string | null;
  }>;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly catalogReady: boolean;
  readonly catalog: ReadonlyMap<EnvironmentId, Pick<ConnectionCatalogEntry, "target">>;
  readonly machineByEnvironmentId: ReadonlyMap<EnvironmentId, EnvironmentMachineKind>;
}) {
  const hosts = [...new Map(input.members.map((member) => [member.environmentId, member])).values()]
    .map((member) => {
      const { environmentId } = member;
      const target = input.catalog.get(environmentId)?.target;
      const neutral =
        !input.catalogReady ||
        environmentId === input.primaryEnvironmentId ||
        (target !== undefined && isDesktopLocalConnectionTarget(target));
      return {
        environmentId,
        label:
          target?.label || member.environmentLabel || `Environment ${environmentId.slice(0, 8)}`,
        machine: input.machineByEnvironmentId.get(environmentId) ?? "server",
        color: neutral ? undefined : environmentAccent(environmentId),
      };
    })
    .sort(
      (a, b) => a.label.localeCompare(b.label) || a.environmentId.localeCompare(b.environmentId),
    );
  const labels = hosts.map((host) => host.label);
  return {
    hosts: hosts.map((host) => ({
      ...host,
      label:
        labels.indexOf(host.label) !== labels.lastIndexOf(host.label)
          ? `${host.label} (${host.environmentId.slice(0, 8)})`
          : host.label,
    })),
    color: !input.catalogReady ? undefined : hosts.length > 1 ? hostAccent(275) : hosts[0]?.color,
  };
}
