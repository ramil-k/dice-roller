// Instance adjectives, shared by <add-to-battle> and the battle-mat overlay so
// a duplicate combatant gets the same "Reckless Wolf" treatment whether it is
// added from a content page or dropped straight onto the map from a pool tab.
//
// The list is mutable module state with a getter/setter so a page can localize
// it once (e.g. AddToBattle.adjectives = [...] delegates here) and every code
// path that names a duplicate — add-to-battle and the mat — sees the override.

const DEFAULT_ADJECTIVES = [
  'Reckless', 'Fearless', 'Cowardly', 'Sneaky', 'Grumpy', 'Jolly', 'Sleepy', 'Rabid', 'Lazy', 'Hungry',
  'Furious', 'Timid', 'Cunning', 'Clumsy', 'Nimble', 'Sturdy', 'Scrawny', 'Burly', 'Shaggy', 'Mangy',
  'One-eyed', 'Toothless', 'Scarred', 'Limping', 'Growling', 'Howling', 'Silent', 'Screeching', 'Drooling', 'Smelly',
  'Ancient', 'Young', 'Elder', 'Feral', 'Tame', 'Wild', 'Frenzied', 'Calm', 'Nervous', 'Bold',
  'Crafty', 'Dim', 'Wise', 'Mad', 'Cheerful', 'Gloomy', 'Sullen', 'Proud', 'Humble', 'Vain',
  'Greedy', 'Generous', 'Spiteful', 'Kind', 'Cruel', 'Gentle', 'Savage', 'Noble', 'Lowly', 'Regal',
  'Swift', 'Sluggish', 'Restless', 'Weary', 'Vigilant', 'Oblivious', 'Curious', 'Wary', 'Trusting', 'Paranoid',
  'Lucky', 'Unlucky', 'Cursed', 'Blessed', 'Haunted', 'Radiant', 'Shadowy', 'Pale', 'Ruddy', 'Ashen',
  'Frostbitten', 'Scorched', 'Soggy', 'Dusty', 'Muddy', 'Bloody', 'Ragged', 'Dapper', 'Shiny', 'Rusty',
  'Whistling', 'Purring', 'Snoring', 'Hiccuping', 'Snuffling', 'Twitchy', 'Unflappable', 'Theatrical', 'Bashful', 'Smug',
];

let current = DEFAULT_ADJECTIVES;

export function getAdjectives() {
  return current;
}

export function setAdjectives(list) {
  current = Array.isArray(list) ? list : DEFAULT_ADJECTIVES;
}

export { DEFAULT_ADJECTIVES };
