import { round, score } from './score.js';

/**
 * Path to directory containing `_list.json` and all levels
 */
const dir = '/data';

function normalizeCreators(creators) {
  if (Array.isArray(creators)) {
    return creators.filter(Boolean);
  }
  return creators ? [creators] : [];
}

function findExistingUser(scoreMap, candidate) {
  const target = String(candidate).toLowerCase();
  return (
    Object.keys(scoreMap).find((u) => u.toLowerCase() === target) || candidate
  );
}

export async function fetchList() {
  const params = new URLSearchParams(document.location.search);
  const whichList = params.get('list');
  let listFileName = '_list';

  if (whichList != null) {
    if (whichList === 'challenge') {
      listFileName = '_challenge-list';
    } else if (whichList === 'nsgdc') {
      listFileName = '_nsgdc-list';
    } else if (whichList === 'maybenew') {
      listFileName = '_maybenewlist';
    }
  }

  try {
    const listResult = await fetch(`${dir}/${listFileName}.json`);
    if (!listResult.ok) {
      throw new Error(`HTTP ${listResult.status}`);
    }
    const list = await listResult.json();

    return await Promise.all(
      list.map(async (path, rank) => {
        try {
          const levelResult = await fetch(`${dir}/${path}.json`);
          if (!levelResult.ok) {
            throw new Error(`HTTP ${levelResult.status}`);
          }
          const level = await levelResult.json();
          const records = Array.isArray(level.records)
            ? [...level.records].sort((a, b) => b.percent - a.percent)
            : [];

          return [
            {
              ...level,
              path,
              records,
            },
            null,
          ];
        } catch {
          console.error(`Failed to load level #${rank + 1} ${path}.`);
          return [null, path];
        }
      }),
    );
  } catch {
    console.error('Failed to load list.');
    return null;
  }
}

export async function fetchPacks() {
  try {
    // Update `_packs.json` if your pack index JSON file uses a different name
    const packsResult = await fetch(`${dir}/_packs.json`);
    if (!packsResult.ok) {
      throw new Error(`HTTP ${packsResult.status}`);
    }
    const packs = await packsResult.json();

    return await Promise.all(
      packs.map(async (path, rank) => {
        try {
          const packResult = await fetch(`${dir}/packs/${path}.json`);
          if (!packResult.ok) {
            throw new Error(`HTTP ${packResult.status}`);
          }
          const pack = await packResult.json();
          return [
            {
              ...pack,
            },
            null,
          ];
        } catch {
          console.error(`Failed to load pack #${rank + 1} ${path}.`);
          return [null, path];
        }
      }),
    );
  } catch {
    console.error('Failed to load packs.');
    return null;
  }
}

export async function fetchEditors() {
  try {
    const editorsResults = await fetch(`${dir}/_editors.json`);
    if (!editorsResults.ok) return null;
    return await editorsResults.json();
  } catch {
    return null;
  }
}

export async function fetchSwagger() {
  try {
    const swaggerResults = await fetch(`${dir}/_players.json`);
    if (!swaggerResults.ok) return null;
    return await swaggerResults.json();
  } catch {
    return null;
  }
}

export async function fetchScratchIds() {
  try {
    const fetchIds = await fetch(`${dir}/_scratch-ids.json`);
    if (!fetchIds.ok) return null;
    return await fetchIds.json();
  } catch {
    return null;
  }
}

export async function fetchWhichLeaderboard() {
  const params = new URLSearchParams(document.location.search);
  const rawType = params.get('type');
  if (!rawType) {
    return await fetchLeaderboard();
  }

  const whichLeaderboard = rawType.toLowerCase();
  if (whichLeaderboard === 'creator') {
    return await fetchCreatorLeaderboard();
  }
  return await fetchLeaderboard();
}

export async function fetchLeaderboard() {
  const list = await fetchList();
  const scoreMap = {};
  const errs = [];

  if (!Array.isArray(list)) {
    return [[], errs];
  }

  list.forEach(([level, err], rank) => {
    if (err || !level) {
      if (err) errs.push(err);
      return;
    }

    // Verification
    if (level.verifier) {
      const verifier = findExistingUser(scoreMap, level.verifier);
      scoreMap[verifier] ??= {
        verified: [],
        completed: [],
        progressed: [],
        created: [],
      };
      scoreMap[verifier].verified.push({
        rank: rank + 1,
        level: level.name,
        score: score(rank + 1, 100, level.percentToQualify),
        link: level.verification,
      });
    }

    // Records
    if (Array.isArray(level.records)) {
      level.records.forEach((record) => {
        if (!record?.user) return;
        const user = findExistingUser(scoreMap, record.user);
        scoreMap[user] ??= {
          verified: [],
          completed: [],
          progressed: [],
          created: [],
        };
        const { completed, progressed } = scoreMap[user];

        if (record.percent === 100) {
          completed.push({
            rank: rank + 1,
            level: level.name,
            score: score(rank + 1, 100, level.percentToQualify),
            link: record.link,
          });
          return;
        }

        progressed.push({
          rank: rank + 1,
          level: level.name,
          percent: record.percent,
          score: score(rank + 1, record.percent, level.percentToQualify),
          link: record.link,
        });
      });
    }

    // Creator
    const creators = normalizeCreators(level.creators);
    for (let index = 0; index < creators.length; index++) {
      const creator = findExistingUser(scoreMap, creators[index]);
      scoreMap[creator] ??= {
        verified: [],
        completed: [],
        progressed: [],
        created: [],
      };
      scoreMap[creator].created.push({
        rank: rank + 1,
        level: level.name,
        score: 0,
        link: level.verification,
      });
    }
  });

  const res = Object.entries(scoreMap).map(([user, scores]) => {
    const { created, verified, completed, progressed } = scores;
    const total = [created, verified, completed, progressed]
      .flat()
      .reduce((prev, cur) => prev + cur.score, 0);

    return {
      user,
      total: round(total),
      ...scores,
    };
  });

  return [res.sort((a, b) => b.total - a.total), errs];
}

export async function fetchCreatorLeaderboard() {
  const list = await fetchList();
  const scoreMap = {};
  const errs = [];

  if (!Array.isArray(list)) {
    return [[], errs];
  }

  list.forEach(([level, err], rank) => {
    if (err || !level) {
      if (err) errs.push(err);
      return;
    }

    // Verification
    if (level.verifier) {
      const verifier = findExistingUser(scoreMap, level.verifier);
      scoreMap[verifier] ??= {
        verified: [],
        completed: [],
        progressed: [],
        created: [],
      };
      scoreMap[verifier].verified.push({
        rank: rank + 1,
        level: level.name,
        score: 0,
        link: level.verification,
      });
    }

    // Records
    if (Array.isArray(level.records)) {
      level.records.forEach((record) => {
        if (!record?.user) return;
        const user = findExistingUser(scoreMap, record.user);
        scoreMap[user] ??= {
          verified: [],
          completed: [],
          progressed: [],
          created: [],
        };
        const { completed, progressed } = scoreMap[user];

        if (record.percent === 100) {
          completed.push({
            rank: rank + 1,
            level: level.name,
            score: 0,
            link: record.link,
          });
          return;
        }

        progressed.push({
          rank: rank + 1,
          level: level.name,
          percent: record.percent,
          score: 0,
          link: record.link,
        });
      });
    }

    // Creator
    const creators = normalizeCreators(level.creators);
    for (let index = 0; index < creators.length; index++) {
      const creator = findExistingUser(scoreMap, creators[index]);
      scoreMap[creator] ??= {
        verified: [],
        completed: [],
        progressed: [],
        created: [],
      };
      scoreMap[creator].created.push({
        rank: rank + 1,
        level: level.name,
        score: 1,
        link: level.verification,
      });
    }
  });

  const res = Object.entries(scoreMap).map(([user, scores]) => {
    const { created, verified, completed, progressed } = scores;
    const total = [created, verified, completed, progressed]
      .flat()
      .reduce((prev, cur) => prev + cur.score, 0);

    return {
      user,
      total: round(total),
      ...scores,
    };
  });

  return [res.sort((a, b) => b.total - a.total), errs];
}

export async function fetchScratchPFPs() {
  const list = await fetchList();
  const scoreMap = {};
  const errs = [];

  if (!Array.isArray(list)) {
    return [[], errs];
  }

  list.forEach(([level, err], rank) => {
    if (err || !level) {
      if (err) errs.push(err);
      return;
    }

    const creators = normalizeCreators(level.creators);
    for (let index = 0; index < creators.length; index++) {
      const creator = findExistingUser(scoreMap, creators[index]);
      scoreMap[creator] ??= {
        verified: [],
        completed: [],
        progressed: [],
      };
      scoreMap[creator].verified.push({
        rank: rank + 1,
        level: level.name,
        score: 1,
        link: level.verification,
      });
    }
  });

  const res = Object.entries(scoreMap).map(([user, scores]) => {
    const { verified, completed, progressed } = scores;
    const total = [verified, completed, progressed]
      .flat()
      .reduce((prev, cur) => prev + cur.score, 0);

    return {
      user,
      total: round(total),
      ...scores,
    };
  });

  return [res.sort((a, b) => b.total - a.total), errs];
}
