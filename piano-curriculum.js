(function (root) {
    'use strict';
    const VERSION = 2;
    const LEGACY_KEYS = [
        'stage1_middleC', 'stage2_maryLamb', 'stage3_jingleBells', 'stage4_odeToJoy',
        'stage5_twinkleStar', 'stage6_cMajorScale', 'stage7_leftHandBass', 'stage8_bothHandsBee',
        'stage9_blackKeyMinuet', 'stage10_canonInD', 'stage11_bachPrelude', 'stage12_furElise'
    ];
    const tiers = ['右手起步', '左手與長短拍', '連奏與移位', '穿指與音階', '半拍與黑鍵', '應用與小音樂會'];
    const notes = (hand, rows) => rows.map(([midi, finger, dur = 1, cue = '']) => ({ midi, finger, hand, dur, cue }));
    const right = rows => notes('R', rows);
    const left = rows => notes('L', rows);
    const extraLessons = {
        step_rightFive: {
            title: '右手五指小樓梯', goal: '🎯 C4–G4 固定手位，逐隻手指輕輕落鍵',
            notes: right([[60,1],[62,2],[64,3],[65,4],[67,5,2],[65,4],[64,3],[62,2],[60,1,2]])
        },
        step_rightSkips: {
            title: '右手小複習：隔一級', goal: '🎯 手位唔變，分清 1–3–5 指；唔使抬高手指',
            notes: right([[60,1],[64,3],[67,5,2],[64,3],[60,1,2],[62,2],[65,4],[62,2],[60,1,2]])
        },
        step_leftThree: {
            title: '左手三指打招呼', goal: '🎯 左手拇指在 G3，向左依次用 1–2–3 指',
            notes: left([[55,1],[53,2],[52,3,2],[53,2],[55,1,2],[52,3],[53,2],[55,1,2]])
        },
        step_longShort: {
            title: '一拍走、兩拍留', goal: '🎯 先拍手數 1、2，再彈；長音唔好提早放手',
            notes: right([[60,1],[60,1],[62,2,2],[64,3],[64,3],[62,2,2],[60,1,2],[60,1,2]])
        },
        step_gPosition: {
            title: '搬屋到 G 手位', goal: '🎯 放鬆移動整隻右手：拇指由 C4 搬到 G4',
            notes: right([[60,1,2],[67,1,2,'先放開 C4，整隻手移到 G4；唔係拇指硬拉過去'],[69,2],[71,3],[72,4],[74,5,2],[72,4],[71,3],[69,2],[67,1,2]])
        },
        step_handDialogue: {
            title: '左右手輪流答', goal: '🎯 左一句、右一句；雙手輪流，唔係同時彈',
            notes: [...left([[48,5],[50,4],[52,3,2]]), ...right([[60,1],[62,2],[64,3,2]]), ...left([[52,3],[50,4],[48,5,2]]), ...right([[64,3],[62,2],[60,1,2]])]
        },
        step_rightThumb: {
            title: '右手穿指小橋', goal: '🎯 慢慢練 Mi 3 → Fa 1；返轉頭 Fa 1 → Mi 3',
            notes: right([[60,1],[62,2],[64,3,2],[65,1,2,'拇指輕輕移到 F4，手腕跟住向右移'],[67,2,2],[65,1,2],[64,3,2,'第 3 指跨過拇指到 E4，唔好扭手腕'],[62,2],[60,1,2]])
        },
        step_leftThumb: {
            title: '左手跨指小橋', goal: '🎯 左手 C3–G3 用 5–4–3–2–1，再跨 3 指到 A3',
            notes: left([[48,5],[50,4],[52,3],[53,2],[55,1,2],[57,3,2,'第 3 指跨過拇指到 A3，手掌跟住移'],[55,1,2,'拇指輕輕穿返 G3'],[53,2],[52,3],[50,4],[48,5,2]])
        },
        step_leftScale: {
            title: '左手 C 大調小音階', goal: '🎯 上行 5–4–3–2–1–3–2–1；下行反轉',
            notes: left([[48,5],[50,4],[52,3],[53,2],[55,1],[57,3,1,'3 指跨到 A3'],[59,2],[60,1,2],[59,2],[57,3],[55,1,1,'拇指穿返 G3'],[53,2],[52,3],[50,4],[48,5,2]])
        },
        step_eighthPairs: {
            title: '半拍小火車', goal: '🎯 一拍分兩粒音，口數「1 同 2 同」；先慢後快',
            notes: right([[60,1,0.5],[62,2,0.5],[64,3,1],[64,3,0.5],[62,2,0.5],[60,1,1],[62,2,0.5],[64,3,0.5],[65,4,0.5],[67,5,0.5],[65,4,1],[60,1,2]])
        },
        step_blackKey: {
            title: '黑鍵三音小路', goal: '🎯 F#4 係三粒黑鍵組最左；右手 2 指輕輕落黑鍵',
            notes: right([[64,1],[66,2,2],[67,3,2],[66,2],[64,1,2],[64,1,0.5],[66,2,0.5],[67,3,1],[66,2],[64,1,2]])
        },
        step_finale: {
            title: '畢業小音樂會：逐句接力', goal: '🎯 複習左手、半拍、穿指及黑鍵；唔求快，先彈得舒服',
            notes: [...left([[48,5],[52,3],[55,1,2]]), ...right([[60,1],[62,2],[64,3],[65,1,1,'右手拇指穿到 F4'],[67,2],[65,1],[64,3,2,'3 指跨返 E4']]),
                ...left([[53,2],[52,3],[48,5,2]]), ...right([[64,1,1,'放開上一句，右手拇指重新放 E4'],[66,2,0.5],[67,3,0.5],[66,2],[64,1,2],[60,1,2,'整隻手搬返 C 手位'],[64,3],[67,5,2],[60,1,2]])]
        }
    };
    // Old lesson IDs stay stable so saved stars, history and badges still refer to the same pieces.
    const sequence = [
        ['stage1_middleC', '右手拇指 C4，2 指 D4，3 指 E4', '手腕自然，手指貼近琴鍵。', 900],
        ['step_rightFive', '右手 1–5 指對 C4、D4、E4、F4、G4', '唔使每隻手指一齊用力。', 900],
        ['stage2_maryLamb', '右手維持 C4–G4 五指手位', '同音保持同一隻手指，放開後再落鍵。', 850],
        ['step_rightSkips', '右手 1 指 C4、3 指 E4、5 指 G4', '眼睛先望下一個音。', 850],
        ['step_leftThree', '左手 1 指 G3、2 指 F3、3 指 E3', '左手指號同右手相同：拇指都係 1。', 900],
        ['stage7_leftHandBass', '左手 5 指 C3、4 指 D3、3 指 E3、2 指 F3、1 指 G3', '手掌自然張開；唔好鎖住手腕。', 900],
        ['step_longShort', '右手 C4–G4 手位', '拍子機每響一下係一拍；本程式唔會判斷按鍵時值。', 900],
        ['stage3_jingleBells', '右手 C4–G4 手位', '每次同音先鬆開再彈，唔好靠手臂用力敲。', 850],
        ['stage4_odeToJoy', '右手 C4–G4 手位', '下一指落鍵時先鬆開上一指，慢慢連起來。', 850],
        ['step_gPosition', '先 C4 拇指，再移到 G4–D5 手位', '移位可以停一停，唔使拉長手指。', 950],
        ['stage5_twinkleStar', '先 C4 拇指；再搬到 D4–A4 手位', '小手用整手移位，唔要求固定撐住 C4–A4。', 900],
        ['step_handDialogue', '左手 C3–G3，右手 C4–G4', '等左手一句完，右手先開始。', 850],
        ['step_rightThumb', '右手從 C4 拇指開始', '穿指係手臂同手掌一齊細移動，唔係屈住拇指。', 1000],
        ['stage6_cMajorScale', '右手 C4 拇指；C5 用 5 指', '先分上、下行慢練，順暢後再串起來。', 900],
        ['step_leftThumb', '左手 C3 用 5 指，G3 用 1 指', '左右手穿指位置唔一樣。', 1000],
        ['step_leftScale', '左手 C3 用 5 指；C4 用 1 指', '下行 A3 的 3 指後，拇指穿返 G3。', 900],
        ['step_eighthPairs', '右手 C4–G4 手位', '先聽示範，再跟拍；半拍唔等於要急。', 900],
        ['stage8_bothHandsBee', '左手 C3–G3，右手 C4–G4', '逐手練熟，再用「自己彈全部音」輪流彈完整首。', 850],
        ['step_blackKey', '右手 1 指 E4、2 指 F#4、3 指 G4', '手指稍微向琴鍵入面移，黑鍵唔使重力按。', 950],
        ['stage9_blackKeyMinuet', '右手 G4–D5；第二句移到 A4–E5', '手位轉換先停一停；簡化節選，唔係原曲完整編配。', 950],
        ['stage10_canonInD', '左手 C3–G3；右手先 C4–G4', '低音單粒輪流彈，換位置先放開；唔係同時和弦。', 950],
        ['stage11_bachPrelude', '左手 C3–G3；右手 C4–G4', '分解音逐粒彈；要移位就讓整隻手跟住走。', 1000],
        ['stage12_furElise', '右手 E5 用 3 指、D#5 用 2 指', '短節選分句慢練；有新手位就先搬手，唔好硬拉。', 1000],
        ['step_finale', '左手 C3–G3；右手先 C4，尾句轉 E4 手位', '每次練 5–10 分鐘便休息；唔舒服就停一停。', 900]
    ];
    function extend(campaign, drills) {
        Object.assign(campaign, extraLessons);
        sequence.forEach(([key, setup, tip, beatMs], index) => {
            const song = campaign[key];
            song.order = index + 1;
            song.isCampaign = true;
            song.tier = `Stage ${Math.floor(index / 4) + 1}：${tiers[Math.floor(index / 4)]}`;
            song.title = `第 ${index + 1} 關：${song.title.replace(/^第 \d+ 關：/, '')}`;
            song.setup = setup;
            song.tip = tip;
            song.beatMs = beatMs;
            if (!song.xpReward) song.xpReward = 50 + index * 5;
        });
        Object.values(drills).forEach(drill => { drill.beatMs = 900; });
        return campaign;
    }
    function serializeNotes(items) {
        const names = ['1', '#1', '2', '#2', '3', '4', '#4', '5', '#5', '6', '#6', '7'];
        return items.map(note => {
            const octave = Math.floor(note.midi / 12) - 5;
            const suffix = octave < 0 ? '.'.repeat(-octave) : "'".repeat(octave);
            const duration = { 0.5: '/2', 1: '', 2: '-', 4: '--' }[note.dur];
            return `${note.hand}${names[note.midi % 12]}${suffix}${duration}:${note.finger}`;
        }).join(' ');
    }
    function reviewPresets(presets, campaign) {
        const copy = items => items.map(note => ({ ...note }));
        const set = (key, title, goal, setup, items, tip) => {
            Object.assign(presets[key], { title, goal, setup, notes: copy(items), beatMs: 950,
                tip: tip || '簡化單音編配；左右手輪流，唔係同時伴奏。移位可停一停，指法請老師按手形核對。' });
            presets[key].rawJianpu = serializeNotes(items);
        };
        set('custom_preset_birthday', '🎵 生日快樂歌（C 大調移位版）', '🎯 簡化拍子；放開再跳音，唔要求撐八度', '右手 G3–D4，全部旋律都由右手彈', right([
            [55,1],[55,1],[57,2],[55,1],[60,4],[59,3,2],
            [55,1],[55,1],[57,2],[55,1],[62,5],[60,4,2],
            [55,1],[55,1],[67,5,1,'放開 G3，整手搬到 C4–G4，5 指落 G4'],[64,3],[60,1],
            [59,2,1,'整手移到 A3–E4，2 指彈 B3'],[57,1,2],
            [65,4,1,'放開 A3，搬返 C4–G4，4 指彈 F4'],[65,4],[64,3],[60,1],[62,2],[60,1,2]
        ]), '每次搬手可以停低；呢個係為小手分句嘅建議指法，唔好按住低音拉去高音。');
        const twinkle = campaign.stage5_twinkleStar.notes;
        const bridge = right([[67,4],[67,4],[65,3],[65,3],[64,2],[64,2],[62,1,2],
            [67,4],[67,4],[65,3],[65,3],[64,2],[64,2],[62,1,2]]);
        bridge[0].cue = '整手移到 D4–A4 手位，4 指彈 G4';
        const repeatTwinkle = copy(twinkle);
        repeatTwinkle[0].cue = '放開 D4，拇指搬返 C4，重複開頭';
        set('custom_preset_twinkle_full', '🎵 小星星（42 音移位版）', '🎯 ABA 三段，重複音用同一指', campaign.stage5_twinkleStar.setup,
            [...twinkle, ...bridge, ...repeatTwinkle], campaign.stage5_twinkleStar.tip);
        set('custom_preset_canon_full', '🎵 卡農（C 大調接力短編）', '🎯 低音與旋律輪流彈，練習換手位', campaign.stage10_canonInD.setup,
            [...campaign.stage10_canonInD.notes, ...right([[60,1,1,'放開上一句，右手移返 C4–G4'],[64,3],[67,5],[64,3],[65,4],[62,2],[64,3],[60,1,2]])]);
        const eliseRepeat = copy(campaign.stage12_furElise.notes);
        eliseRepeat[0].cue = '放開 C5，右手移返 E5 用 3 指、D#5 用 2 指嘅開頭位置';
        set('custom_preset_elise_full', '🎵 致愛麗絲（移位短節選複習）', '🎯 分句接力；係簡化短節選，唔係全首', campaign.stage12_furElise.setup,
            [...campaign.stage12_furElise.notes, ...eliseRepeat]);
        const london = copy(presets.custom_preset_london_full.notes);
        [7, 11, 15, 23, 28].forEach(index => { london[index].dur = 2; });
        london[london.length - 1].cue = '右手放開 E4，拇指由 D4 搬到 C4';
        set('custom_preset_london_full', '🎵 倫敦鐵橋（左右手接力版）', '🎯 右手唱旋律，左手低音插句；唔係同時合奏', '左手 C3–G3；右手 D4–A4', london);
        const ode = copy(presets.custom_preset_ode_full.notes);
        [18, 37].forEach(index => { ode[index].dur = 2; });
        set('custom_preset_ode_full', '🎵 歡樂頌（主題接力版）', '🎯 主題短編，低音與旋律輪流彈', '左手 C3–G3；右手 C4–G4', ode);
        return presets;
    }
    function isUnmodifiedPreset(saved, original) {
        return !!original && ['title', 'goal', 'rawJianpu', 'notes', 'xpReward'].every(key =>
            JSON.stringify(saved[key]) === JSON.stringify(original[key]));
    }
    function migrateProfile(profile, campaign) {
        const count = sequence.length;
        if (profile.curriculumVersion !== VERSION) {
            const oldOrder = Math.max(1, Math.min(LEGACY_KEYS.length, Math.floor(Number(profile.unlockedStageOrder) || 1)));
            let unlocked = campaign[LEGACY_KEYS[oldOrder - 1]].order;
            Object.entries(profile.stageProgress || {}).forEach(([key, progress]) => {
                if (campaign[key]?.isCampaign && progress && (progress.stars > 0 || progress.bestAcc >= 80)) {
                    unlocked = Math.max(unlocked, campaign[key].order + 1);
                }
            });
            profile.unlockedStageOrder = Math.min(count, unlocked);
            profile.curriculumVersion = VERSION;
        }
        profile.unlockedStageOrder = Math.max(1, Math.min(count, Math.floor(Number(profile.unlockedStageOrder) || 1)));
        return profile;
    }
    function evaluatePerformance(noteCount, correctHits, totalAttempts) {
        const accuracy = totalAttempts > 0 ? Math.round(correctHits / totalAttempts * 100) : 0;
        const complete = noteCount > 0 && correctHits === noteCount;
        const passed = complete && accuracy >= 80;
        return { accuracy, complete, passed, stars: passed ? (accuracy >= 95 ? 3 : accuracy >= 88 ? 2 : 1) : 0 };
    }
    function nextLessonKey(campaign, key, unlockedOrder) {
        const current = campaign[key];
        if (!current?.isCampaign) return null;
        const next = Object.entries(campaign).find(([, song]) => song.isCampaign && song.order === current.order + 1 && song.order <= unlockedOrder);
        return next ? next[0] : null;
    }
    const api = { VERSION, LEGACY_KEYS, extend, reviewPresets, isUnmodifiedPreset, serializeNotes, migrateProfile, evaluatePerformance, nextLessonKey, count: sequence.length };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.PianoCurriculum = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
