/* global window */
(function () {
  function getUserFromResult(user) {
    if (!user) return null;
    const legacy = user.legacy || user;
    const core = user.core || {};
    const avatar = user.avatar || {};
    return {
      id: user.rest_id || legacy.id_str || "",
      name: legacy.name || core.name || "",
      screenName: legacy.screen_name || core.screen_name || "",
      avatarUrl:
        legacy.profile_image_url_https ||
        avatar.image_url ||
        "",
      verified: Boolean(user.is_blue_verified || legacy.verified),
    };
  }

  function parseMedia(legacy, extendedEntities) {
    const entities = extendedEntities?.media || legacy?.entities?.media || [];
    return entities.map((m) => ({
      type: m.type || "photo",
      url: m.media_url_https || m.url || "",
      previewUrl: m.media_url_https || "",
      videoUrl: m.video_info?.variants?.find((v) => v.content_type === "video/mp4")?.url || null,
    }));
  }

  function parseTweetResult(result) {
    if (!result) return null;
    if (result.__typename === "TweetTombstone") return null;

    const tweet =
      result.tweet ||
      result.tweet_results?.result ||
      result;

    if (!tweet || tweet.__typename === "TweetTombstone") return null;

    const legacy = tweet.legacy || tweet;
    const noteTweet = tweet.note_tweet?.note_tweet_results?.result;
    const text = noteTweet?.text || legacy.full_text || legacy.text || "";

    const userResult =
      tweet.core?.user_results?.result ||
      legacy.user ||
      null;

    const author = getUserFromResult(userResult);
    if (!author) return null;

    const id = tweet.rest_id || legacy.id_str;
    const screenName = author.screenName;

    let quotedTweet = null;
    const quoted =
      tweet.quoted_status_result?.result ||
      legacy.quoted_status_result?.result;
    if (quoted) {
      quotedTweet = parseTweetResult(quoted);
    }

    return {
      id,
      url: screenName ? `https://x.com/${screenName}/status/${id}` : `https://x.com/i/status/${id}`,
      text,
      createdAt: legacy.created_at ? new Date(legacy.created_at).toISOString() : null,
      author,
      media: parseMedia(legacy, tweet.extended_entities),
      metrics: {
        likes: legacy.favorite_count ?? 0,
        retweets: legacy.retweet_count ?? 0,
        replies: legacy.reply_count ?? 0,
        bookmarks: legacy.bookmark_count ?? 0,
        views: tweet.views?.count ? parseInt(tweet.views.count, 10) : null,
      },
      quotedTweet,
      lang: legacy.lang || null,
    };
  }

  function extractTweetsFromInstructions(instructions) {
    const tweets = [];
    if (!Array.isArray(instructions)) return tweets;

    for (const instruction of instructions) {
      if (instruction.type === "TimelineAddEntries" && instruction.entries) {
        for (const entry of instruction.entries) {
          const item =
            entry.content?.itemContent?.tweet_results?.result ||
            entry.content?.content?.tweetResult?.result ||
            entry.content?.itemContent?.tweetResult?.result;

          const parsed = parseTweetResult(item);
          if (parsed) tweets.push(parsed);
        }
      }

      if (instruction.type === "TimelineReplaceEntry" && instruction.entry) {
        const item =
          instruction.entry.content?.itemContent?.tweet_results?.result;
        const parsed = parseTweetResult(item);
        if (parsed) tweets.push(parsed);
      }
    }

    return tweets;
  }

  function extractCursor(instructions) {
    if (!Array.isArray(instructions)) return null;

    let bottomCursor = null;

    for (const instruction of instructions) {
      const entries = instruction.entries || [];
      for (const entry of entries) {
        const content = entry.content || {};
        const isBottom =
          content.cursorType === "Bottom" ||
          (content.entryType === "TimelineTimelineCursor" &&
            content.cursorType === "Bottom") ||
          String(entry.entryId || "").startsWith("cursor-bottom");

        if (isBottom && content.value) {
          bottomCursor = content.value;
        }
      }
    }

    return bottomCursor;
  }

  function parseBookmarkResponse(payload) {
    if (!payload) return { tweets: [], cursor: null };

    const paths = [
      payload?.data?.bookmark_timeline_v2?.timeline?.instructions,
      payload?.data?.bookmark_search_timeline?.timeline?.instructions,
      payload?.data?.bookmarks?.timeline?.instructions,
      payload?.data?.user?.result?.timeline_v2?.timeline?.instructions,
    ];

    for (const instructions of paths) {
      const tweets = extractTweetsFromInstructions(instructions);
      if (tweets.length || instructions) {
        return {
          tweets,
          cursor: extractCursor(instructions),
        };
      }
    }

    return { tweets: [], cursor: null };
  }

  window.XBookmarksParser = {
    parseBookmarkResponse,
    parseTweetResult,
  };
})();
