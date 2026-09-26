// Metadata only: home/navigation must not eagerly import the fixture factories.
export const scenarios = [
  { id: 'waiting', title: '等待入席', subtitle: '牌未发，心局已开', description: '三人入席，筹码齐备。看看一局开始前的安静时刻。' },
  { id: 'blind', title: '盲牌在手', subtitle: '未知，也是一种筹码', description: '自己的三张牌仍然朝下，牌面不会出现在页面中。' },
  { id: 'seen', title: '看牌之后', subtitle: '知己，然后读人', description: '展示已看过的手牌。对手的秘密仍留在牌背之后。' },
  { id: 'settlement', title: '本局落定', subtitle: '输赢，落在账面', description: '查看一局结束后的固定余额，不重复计算输赢。' },
  { id: 'six-seats', title: '六人同席', subtitle: '满座，各有心思', description: '一名玩家与五位对手，检查小屏幕上的名册与阅读顺序。' },
  { id: 'compare-private', title: '旁观比牌', subtitle: '胜负可知，底牌不见', description: '两位对手比牌之后，旁观者只能看到公开状态。' },
] as const
