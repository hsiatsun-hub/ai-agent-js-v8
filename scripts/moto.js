import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { client } from "../lib/openai.js";
import {
  qdrant,
  moto_COLLECTION,
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
} from "../lib/qdrant.js";

const CSV_PATH = "data/moto.csv";
const BATCH_SIZE = 100;

function rowToText(row) {
  return [
    row.Brand,
    row.Category,
    row.Displacement,
    row.Transmission,
    row.License_Class,
    row.Seat_Height,
    row.Curb_Weight,
    row.Safety_System,
  ]
    .filter(Boolean)
    .join(" | ");
}

async function recreateCollection() {
  const exists = await qdrant.collectionExists(moto_COLLECTION);
  if (exists.exists) {
    await qdrant.deleteCollection(moto_COLLECTION);
  }
  await qdrant.createCollection(moto_COLLECTION, {
    vectors: { size: EMBEDDING_DIM, distance: "Cosine" },
  });
}

async function embedBatch(texts) {
  const res = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });
  return res.data.map((d) => d.embedding);
}

async function main() {
  const csv = await readFile(CSV_PATH, "utf8");
  const rows = parse(csv, { columns: true, skip_empty_lines: true });
  console.log(`讀到 ${rows.length} 筆資料`);

  await recreateCollection();
  console.log(`已建立 collection: ${moto_COLLECTION}`);

  let processed = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const texts = batch.map(rowToText);
    const vectors = await embedBatch(texts);

    const points = batch.map((row, idx) => ({
      id: i + idx,
      vector: vectors[idx],
      payload: {
        Brand: row.Brand,
        Category: row.Category,
        Displacement: row.Displacement,
        Transmission: row.Transmission,
        License_Class: row.License_Class,
        Seat_Height: row.Seat_Height,
        Curb_Weight: row.Curb_Weight,
        Safety_System: row.Safety_System,
              },
    }));

    await qdrant.upsert(moto_COLLECTION, { wait: true, points });
    processed += batch.length;
    console.log(`進度：${processed} / ${rows.length}`);
  }

  console.log("完成！");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
