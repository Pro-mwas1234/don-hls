import { Parser } from "m3u8-parser";
import { ERROR, PLAYLIST, SEGMENT } from "../constant";

interface ParseHlsOptions {
  hlsUrl: string;
  headers?: Record<string, string>;
}

export interface Segment {
  uri: string;
  [key: string]: any;
}

interface Playlist {
  name: string;
  bandwidth: number;
  uri: string;
}

interface ParseHlsResult {
  type: string;
  data: Playlist[] | Segment[] | string;
}

/**
 * Auto-upgrade the quality variant in HLS URLs.
 * Replaces index-f{n}-v with index-f1-v since f1 = highest quality.
 * Works on both the manifest URL and individual segment URLs.
 */
function upgradeToF1(url: string): string {
  return url.replace(/index-f(\d+)-v/g, "index-f1-v");
}

async function parseHls({
  hlsUrl,
  headers = {},
}: ParseHlsOptions): Promise<ParseHlsResult> {
  try {
    // Auto-upgrade to f1 (best quality) before fetching
    const upgradedUrl = upgradeToF1(hlsUrl);
    let url = new URL(upgradedUrl);

    let response = await fetch(url.href, {
      headers: {
        ...headers,
      },
    });
    if (!response.ok) throw new Error(await response.text());
    let manifest = await response.text();

    var parser = new Parser();
    parser.push(manifest);
    parser.end();

    let path = upgradedUrl;

    try {
      let pathBase = url.pathname.split("/");
      pathBase.pop();
      pathBase.push("{{URL}}");
      path = pathBase.join("/");
    } catch (perror) {
      console.info(`[Info] Path parse error`, perror);
    }

    let base = url.origin + path;

    if (parser.manifest.playlists?.length) {
      const groups = parser.manifest.playlists
        .map((g: any) => {
          return {
            name: g.attributes.NAME
              ? g.attributes.NAME
              : g.attributes.RESOLUTION
              ? `${g.attributes.RESOLUTION.width}x${g.attributes.RESOLUTION.height}`
              : `MAYBE_AUDIO:${g.attributes.BANDWIDTH}`,
            bandwidth: g.attributes.BANDWIDTH,
            uri: upgradeToF1(
              g.uri.startsWith("http") ? g.uri : base.replace("{{URL}}", g.uri)
            ),
          } as Playlist;
        })
        .filter((g: Playlist | null) => g);

      return {
        type: PLAYLIST,
        data: groups as Playlist[],
      };
    } else if (parser.manifest.segments?.length) {
      let segments = parser.manifest.segments;
      segments = segments.map((s: any) => ({
        ...s,
        uri: upgradeToF1(
          s.uri.startsWith("http") ? s.uri : base.replace("{{URL}}", s.uri)
        ),
      }));

      return {
        type: SEGMENT,
        data: segments as Segment[],
      };
    }

    throw new Error("No playlists or segments found");
  } catch (error: any) {
    return {
      type: ERROR,
      data: error.message,
    };
  }
}

export default parseHls;
