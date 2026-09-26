import { createSqliteBinding } from "./sqlite-binding.mjs";

let binding;
export const env = {
  get DB() {
    const filename = process.env.DATABASE_PATH;
    if (!filename) throw new Error("DATABASE_PATH must point to the VPS SQLite database.");
    return binding ??= createSqliteBinding(filename);
  },
};
