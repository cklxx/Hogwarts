/**
 * "Hogwarts: A History" — what the real (canon) Hogwarts is like, and where the game honours it.
 * Served over MCP so agents (and curious players) can read it. Hermione would approve.
 */
export const HISTORY: { topic: string; fact: string; inGame?: string }[] = [
  { topic: 'founding', fact: 'Founded around 990 AD by Godric Gryffindor, Helga Hufflepuff, Rowena Ravenclaw and Salazar Slytherin, in the Scottish Highlands, far from Muggle eyes.', inGame: 'Four houses; every wizard is sorted on enrolment.' },
  { topic: 'motto', fact: 'The school motto is "Draco dormiens nunquam titillandus" — never tickle a sleeping dragon.', inGame: 'It is the default Ministry proclamation.' },
  { topic: 'apparition', fact: 'You cannot Apparate or Disapparate within Hogwarts grounds — as Hermione reminds everyone, constantly. Apparition is taught to sixth-years, and the test is taken at seventeen.', inGame: 'apparate is a year-6 primitive and fails on the grounds unless a Minister decrees `magic.apparitionOnGrounds`. Hogsmeade and the far forest are outside the wards.' },
  { topic: 'unplottable', fact: 'Hogwarts is Unplottable, and to Muggles it looks like a ruin with a sign: DANGER, DO NOT ENTER, UNSAFE.' },
  { topic: 'staircases', fact: 'There are 142 staircases at Hogwarts, some of which move on Fridays; some have a vanishing step you must remember to jump.' },
  { topic: 'great hall', fact: 'The Great Hall ceiling is bewitched to look like the sky outside. Four long house tables, one staff table, floating candles.', inGame: 'A safe zone by default. The client renders its ceiling from the live weather.' },
  { topic: 'house cup', fact: 'Houses earn and lose points throughout the year; the House Cup is awarded at the end-of-year feast.', inGame: 'Each term, house points = the sum of reputation its members earned that term.' },
  { topic: 'marauders map', fact: 'Created by Moony, Wormtail, Padfoot and Prongs. Activate with "I solemnly swear that I am up to no good"; wipe with "Mischief managed". It shows everyone in the castle, and it never lies.', inGame: 'Try saying it.' },
  { topic: 'room of requirement', fact: 'The Come-and-Go Room, on the seventh floor opposite the tapestry of Barnabas the Barmy. Walk past three times thinking hard about what you need.', inGame: 'Something of Ravenclaw\'s was hidden there.' },
  { topic: 'mirror of erised', fact: '"Erised stra ehru oyt ube cafru oyt on wohsi" — it shows not your face but your heart\'s desire. Dumbledore moved it into a disused classroom one Christmas.' },
  { topic: 'whomping willow', fact: 'Planted the year Remus Lupin arrived, to guard the passage to the Shrieking Shack. Pressing the knot at its roots freezes it.', inGame: 'Hitting its trunk with a binding (root) bolt calms it.' },
  { topic: 'forbidden forest', fact: 'Home to centaurs, unicorns, thestrals and a colony of Acromantulas founded by Aragog.', inGame: 'Spiders spawn in the forest. They hate fire.' },
  { topic: 'devils snare', fact: 'A plant that constricts anything that struggles. It likes the dark and the damp; fire or sunlight (Lumos Solem) makes it let go.', inGame: 'Weak to fire (x2) and light (x3).' },
  { topic: 'troll', fact: 'Mountain trolls are twelve feet tall, dim, and hit very hard. On Halloween 1991 one was knocked out with its own club via Wingardium Leviosa.', inGame: 'A spell whose incantation is "Wingardium Leviosa" does triple damage to trolls. Pronounce it properly.' },
  { topic: 'dementors', fact: 'Guards of Azkaban. They drain happiness; only a Patronus drives them off.', inGame: 'Dementors come out at night by the lake, take a quarter damage from ordinary magic, and burn in a Patronus.' },
  { topic: 'unforgivable curses', fact: 'Avada Kedavra, Crucio and Imperio. Use of any one on a human earns a life sentence in Azkaban.', inGame: 'Casting a spell named after one sends you to Azkaban and costs a quarter of your reputation — while the Ministry stands.' },
  { topic: 'elder wand', fact: 'The most powerful wand ever made; its allegiance passes to whoever defeats its master — even by a simple Disarming Charm. It was buried with Dumbledore in his white tomb.', inGame: 'It lies at Dumbledore\'s Tomb. Stun or disarm its master to take it.' },
  { topic: 'time turners', fact: 'Every Time-Turner in the Ministry\'s stock was smashed in the Battle of the Department of Mysteries in 1996.', inGame: 'The forge refuses to make one.' },
  { topic: 'taboo', fact: 'During the Second Wizarding War the name "Voldemort" was made Taboo: speaking it broke protective enchantments and revealed the speaker.', inGame: 'If the Ministry ever falls (unforgivables unbanned), saying the name reveals you.' },
  { topic: 'wands', fact: 'Ollivanders: makers of fine wands since 382 BC. The wand chooses the wizard. Cores: phoenix feather, dragon heartstring, unicorn hair.', inGame: 'Your wand core gives a small permanent bonus.' },
];
