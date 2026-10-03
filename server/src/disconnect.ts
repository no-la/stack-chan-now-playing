import { unlink } from "node:fs/promises";

const tokenFile = new URL("../data/spotify-tokens.json", import.meta.url);

try {
  await unlink(tokenFile);
  console.log("Deleted the locally stored Spotify OAuth tokens.");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") {
    console.log("No locally stored Spotify OAuth tokens were found.");
  } else {
    throw error;
  }
}
