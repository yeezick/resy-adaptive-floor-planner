// Large-party requests fixture, loaded once and validated. Fictional requests only.
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseRequestBook, type RequestBook } from "../domain/requests";
import { getRoom } from "./rooms";

export function requestsPath(): string {
  return path.resolve(
    process.cwd(),
    process.env.REQUESTS_PATH ?? "fixtures/requests/requests.json",
  );
}

export function loadRequestBook(file = requestsPath()): RequestBook {
  const book = parseRequestBook(JSON.parse(readFileSync(file, "utf8")));
  for (const r of book.requests)
    if (!getRoom(r.bookRoomId))
      throw new Error(`request ${r.id}: unknown bookRoomId "${r.bookRoomId}"`);
  return book;
}

let cache: RequestBook | undefined;
export function requestBook(): RequestBook {
  cache ??= loadRequestBook();
  return cache;
}
