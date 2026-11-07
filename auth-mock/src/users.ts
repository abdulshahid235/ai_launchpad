export type SeedUser = {
  email: string;
  password: string;
  name: string;
  /** Stable UUID used as both sub and oid (owner_object_id). */
  oid: string;
};

export const SEED_USERS: SeedUser[] = [
  {
    email: "owner@hni.test",
    password: "password",
    name: "Owner",
    oid: "a1000000-0000-4000-8000-000000000001",
  },
  {
    email: "tester@hni.test",
    password: "password",
    name: "Tester",
    oid: "a1000000-0000-4000-8000-000000000002",
  },
  {
    email: "approver@hni.test",
    password: "password",
    name: "Approver",
    oid: "a1000000-0000-4000-8000-000000000003",
  },
];

export function findByEmail(email: string): SeedUser | undefined {
  return SEED_USERS.find(
    (user) => user.email.toLowerCase() === email.trim().toLowerCase(),
  );
}

export function findByOid(oid: string): SeedUser | undefined {
  return SEED_USERS.find((user) => user.oid === oid);
}
