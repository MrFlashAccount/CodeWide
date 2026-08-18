import {
  createCollection,
  createLiveQueryCollection,
  eq,
  localOnlyCollectionOptions,
} from "@tanstack/db";

type Row = { id: string; sealed: boolean; text: string };

void main();

async function main() {
const source = createCollection(localOnlyCollectionOptions<Row, string>({
  id: "identity-source",
  getKey: (row) => row.id,
  initialData: [
    { id: "sealed-a", sealed: true, text: "a" },
    { id: "sealed-b", sealed: true, text: "b" },
    { id: "live", sealed: false, text: "first" },
  ],
}));
const sealed = createLiveQueryCollection((query) => query
  .from({ row: source })
  .where(({ row }) => eq(row.sealed, true)));
const live = createLiveQueryCollection((query) => query
  .from({ row: source })
  .where(({ row }) => eq(row.sealed, false)));

await Promise.all([source.preload(), sealed.preload(), live.preload()]);
const before = sealed.toArray;
const transaction = source.update("live", (draft) => { draft.text = "second"; });
await transaction.isPersisted.promise;
await new Promise((resolve) => setTimeout(resolve, 0));
const after = sealed.toArray;

const result = {
  sealedArrayStable: before === after,
  sealedRowsStable: before.length === after.length && before.every((row, index) => row === after[index]),
  before: before.map((row) => row.id),
  after: after.map((row) => row.id),
  live: live.toArray.map((row) => row.text),
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.sealedRowsStable) process.exitCode = 1;
}
