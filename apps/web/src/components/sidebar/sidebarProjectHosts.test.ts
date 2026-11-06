import { EnvironmentId } from "@t3tools/contracts";
import {
  BearerConnectionTarget,
  PrimaryConnectionTarget,
  type ConnectionCatalogEntry,
} from "@t3tools/client-runtime/connection";
import { describe, expect, it } from "vite-plus/test";

import { resolveSidebarProjectHosts } from "./sidebarProjectHosts";

const primary = EnvironmentId.make("primary");
const remote = EnvironmentId.make("remote");
const desktop = EnvironmentId.make("desktop");
const member = (environmentId: EnvironmentId, environmentLabel: string | null) => ({
  environmentId,
  environmentLabel,
});

function setup() {
  return {
    primaryEnvironmentId: primary,
    catalogReady: true,
    catalog: new Map<EnvironmentId, Pick<ConnectionCatalogEntry, "target">>([
      [
        primary,
        {
          target: new PrimaryConnectionTarget({
            environmentId: primary,
            label: "Laptop",
            httpBaseUrl: "http://localhost",
            wsBaseUrl: "ws://localhost",
          }),
        },
      ],
      [
        desktop,
        {
          target: new BearerConnectionTarget({
            environmentId: desktop,
            label: "Local Linux",
            connectionId: "local:linux",
          }),
        },
      ],
      [
        remote,
        {
          target: new BearerConnectionTarget({
            environmentId: remote,
            label: "Mac mini",
            connectionId: "saved-remote",
          }),
        },
      ],
    ]),
    machineByEnvironmentId: new Map([[remote, "mac-mini" as const]]),
  };
}

describe("sidebar project hosts", () => {
  it("keeps primary and desktop-local environments neutral without guessing locality from URLs", () => {
    const input = setup();
    for (const id of [primary, desktop]) {
      const result = resolveSidebarProjectHosts({ ...input, members: [member(id, null)] });
      expect(result.color).toBeUndefined();
      expect(result.hosts[0]?.color).toBeUndefined();
    }
    const result = resolveSidebarProjectHosts({ ...input, members: [member(remote, null)] });
    expect(result.color).toBeTruthy();
    expect(result.hosts[0]).toMatchObject({
      label: "Mac mini",
      machine: "mac-mini",
      color: result.color,
    });
    expect(
      resolveSidebarProjectHosts({
        ...input,
        catalogReady: false,
        members: [member(remote, null)],
      }).color,
    ).toBeUndefined();
    expect(
      resolveSidebarProjectHosts({
        ...input,
        primaryEnvironmentId: null,
        members: [member(remote, null)],
      }).color,
    ).toBe(result.color);
  });

  it("deduplicates by identity and identifies mixed groups without attributing them to one host", () => {
    const input = setup();
    const members = [
      member(remote, "Mac mini"),
      member(primary, "Laptop"),
      member(remote, "Mac mini"),
    ];
    const result = resolveSidebarProjectHosts({ ...input, members });
    expect(result.hosts.map((host) => host.environmentId)).toEqual([primary, remote]);
    expect(result.color).toBeTruthy();
    expect(result.color).not.toBe(result.hosts[1]?.color);
    expect(resolveSidebarProjectHosts({ ...input, members: [...members].reverse() })).toEqual(
      result,
    );
    const renamed = new Map(input.catalog);
    renamed.delete(remote);
    const duplicate = resolveSidebarProjectHosts({
      ...input,
      catalog: renamed,
      members: [member(primary, "Laptop"), member(remote, "Laptop")],
    });
    expect(duplicate.hosts.map((host) => host.label)).toEqual([
      "Laptop (primary)",
      "Laptop (remote)",
    ]);
  });

  it("keeps accents stable through renames and unavailable metadata", () => {
    const input = setup();
    const original = resolveSidebarProjectHosts({
      ...input,
      members: [member(remote, "Mac mini")],
    });
    const offline = resolveSidebarProjectHosts({
      ...input,
      catalog: new Map(),
      machineByEnvironmentId: new Map(),
      members: [member(remote, "Renamed host")],
    });
    expect(offline.color).toBe(original.color);
    expect(offline.hosts[0]).toMatchObject({ label: "Renamed host", machine: "server" });
    expect(
      resolveSidebarProjectHosts({ ...input, catalog: new Map(), members: [member(remote, null)] })
        .hosts[0]?.label,
    ).toBe("Environment remote");
    expect(
      resolveSidebarProjectHosts({
        ...input,
        members: [member(remote, null), member(remote, null)],
      }).color,
    ).toBe(original.color);
  });
});
