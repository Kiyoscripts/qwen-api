/* The real voice roster, generated from GET /v1/audio/voices.
 *
 * 78 voices, not a sample. They carry a gender and a one-line
 * description because that is what makes a roster this size choosable: a bare
 * list of 78 names is not a picker, it is a wall.
 */

export interface Voice {
  speaker: string;
  name: string;
  gender: "male" | "female";
  description: string;
  kind: "audio" | "omni";
}

export const VOICES: Voice[] = [
  {
    "speaker": "Cherry",
    "name": "Cherry",
    "gender": "female",
    "description": "A cheerful, friendly, and natural young woman's voice.",
    "kind": "audio"
  },
  {
    "speaker": "Dylan",
    "name": "Dylan",
    "gender": "male",
    "description": "A teenager who grew up in the hutongs of Beijing.",
    "kind": "audio"
  },
  {
    "speaker": "Kiki",
    "name": "Kiki",
    "gender": "female",
    "description": "A sweet best friend from Hong Kong.",
    "kind": "audio"
  },
  {
    "speaker": "Peter",
    "name": "Peter",
    "gender": "male",
    "description": "A voice for the straight man in Tianjin crosstalk.",
    "kind": "audio"
  },
  {
    "speaker": "Vivian",
    "name": "Vivian",
    "gender": "female",
    "description": "A cool, cute, and slightly grumpy voice.",
    "kind": "audio"
  },
  {
    "speaker": "Serena",
    "name": "Serena",
    "gender": "female",
    "description": "A gentle young woman's voice.",
    "kind": "audio"
  },
  {
    "speaker": "Momo",
    "name": "Momo",
    "gender": "female",
    "description": "A playful and cute voice to cheer you up.",
    "kind": "audio"
  },
  {
    "speaker": "Moon",
    "name": "Moon",
    "gender": "male",
    "description": "The serene and effortless Yuebai",
    "kind": "audio"
  },
  {
    "speaker": "Eric",
    "name": "Eric",
    "gender": "male",
    "description": "An unconventional and refined male voice from Chengdu, Sichuan.",
    "kind": "audio"
  },
  {
    "speaker": "Ethan",
    "name": "Ethan",
    "gender": "male",
    "description": "Standard Mandarin with a slight northern accent. A bright, warm, and energetic voice.",
    "kind": "audio"
  },
  {
    "speaker": "Aiden",
    "name": "Aiden",
    "gender": "male",
    "description": "A young American man who is a great cook.",
    "kind": "audio"
  },
  {
    "speaker": "Jada",
    "name": "Jada",
    "gender": "female",
    "description": "A lively woman from Shanghai.",
    "kind": "audio"
  },
  {
    "speaker": "Lenn",
    "name": "Lenn",
    "gender": "male",
    "description": "Rational at the core and rebellious in the details—a young German who wears a suit and listens to post-punk.",
    "kind": "audio"
  },
  {
    "speaker": "Andre",
    "name": "Andre",
    "gender": "male",
    "description": "A magnetic, natural, and calm male voice.",
    "kind": "audio"
  },
  {
    "speaker": "Rocky",
    "name": "Rocky",
    "gender": "male",
    "description": "A witty and humorous male voice for online chats.",
    "kind": "audio"
  },
  {
    "speaker": "Arthur",
    "name": "Arthur",
    "gender": "male",
    "description": "A rustic, weathered voice of an old storyteller.",
    "kind": "audio"
  },
  {
    "speaker": "Eldric Sage",
    "name": "Eldric Sage",
    "gender": "male",
    "description": "A calm, wise, and weathered old man's voice.",
    "kind": "audio"
  },
  {
    "speaker": "Bunny",
    "name": "Bunny",
    "gender": "female",
    "description": "A little loli brimming with moe appeal.",
    "kind": "audio"
  },
  {
    "speaker": "Neil",
    "name": "Neil",
    "gender": "male",
    "description": "A professional news anchor's voice with a clear, steady tone.",
    "kind": "audio"
  },
  {
    "speaker": "Sohee",
    "name": "Sohee",
    "gender": "female",
    "description": "A gentle and cheerful Korean unnie with an expressive personality.",
    "kind": "audio"
  },
  {
    "speaker": "Ebona",
    "name": "Ebona",
    "gender": "female",
    "description": "Her whisper is like a rusty key, slowly turning in the deepest, darkest corners of your heart—where the childhood shadows you dare not acknowledge and your unknown fears hide.",
    "kind": "audio"
  },
  {
    "speaker": "Seren",
    "name": "Seren",
    "gender": "female",
    "description": "A gentle and soothing voice for sleep aids.",
    "kind": "audio"
  },
  {
    "speaker": "Pip",
    "name": "Pip",
    "gender": "male",
    "description": "Mischievous yet full of childlike innocence, he has arrived. Is this the Shin-chan you remember?",
    "kind": "audio"
  },
  {
    "speaker": "Stella",
    "name": "Stella",
    "gender": "female",
    "description": "A sweet magical girl voice that can be both ditsy and powerful.",
    "kind": "audio"
  },
  {
    "speaker": "Ono Anna",
    "name": "Ono Anna",
    "gender": "female",
    "description": "A quirky and clever childhood friend's voice.",
    "kind": "audio"
  },
  {
    "speaker": "Jennifer",
    "name": "Jennifer",
    "gender": "female",
    "description": "A premium, cinematic American English female voice.",
    "kind": "audio"
  },
  {
    "speaker": "Mochi",
    "name": "Mochi",
    "gender": "female",
    "description": "A smart and precocious child's voice.",
    "kind": "audio"
  },
  {
    "speaker": "Radio Gol",
    "name": "Radio Gol",
    "gender": "male",
    "description": "Football Poet Rádio Gol! Today, I'll be calling the football game for you using names.",
    "kind": "audio"
  },
  {
    "speaker": "Marcus",
    "name": "Marcus",
    "gender": "male",
    "description": "A sincere and deep voice from Shaanxi.",
    "kind": "audio"
  },
  {
    "speaker": "Katerina",
    "name": "Katerina",
    "gender": "female",
    "description": "A mature and rhythmic female voice.",
    "kind": "audio"
  },
  {
    "speaker": "Li",
    "name": "Li",
    "gender": "male",
    "description": "A patient yoga teacher.",
    "kind": "audio"
  },
  {
    "speaker": "Roy",
    "name": "Roy",
    "gender": "male",
    "description": "A humorous, straightforward, and lively young man from Taiwan.",
    "kind": "audio"
  },
  {
    "speaker": "Maia",
    "name": "Maia",
    "gender": "female",
    "description": "A voice that blends intelligence and gentleness.",
    "kind": "audio"
  },
  {
    "speaker": "Nofish",
    "name": "Nofish",
    "gender": "male",
    "description": "A designer who doesn't use retroflex consonants.",
    "kind": "audio"
  },
  {
    "speaker": "Mia",
    "name": "Miar",
    "gender": "female",
    "description": "Gentle as spring water, pure as the first snow",
    "kind": "audio"
  },
  {
    "speaker": "Bellona",
    "name": "Bellona",
    "gender": "female",
    "description": "A powerful and clear voice for epic storytelling, full of passion and life.",
    "kind": "audio"
  },
  {
    "speaker": "Chelsie",
    "name": "Chelsie",
    "gender": "female",
    "description": "An anime-style virtual girlfriend voice.",
    "kind": "audio"
  },
  {
    "speaker": "Kai",
    "name": "Kai",
    "gender": "male",
    "description": "A spa for your ears",
    "kind": "audio"
  },
  {
    "speaker": "Sonrisa",
    "name": "Sonrisa",
    "gender": "female",
    "description": "A warm, cheerful Latin American woman",
    "kind": "audio"
  },
  {
    "speaker": "Ryan",
    "name": "Ryan",
    "gender": "male",
    "description": "A rhythmic, dramatic voice with realism and tension.",
    "kind": "audio"
  },
  {
    "speaker": "Emilien",
    "name": "Emilien",
    "gender": "male",
    "description": "Romantic French Big Brother",
    "kind": "audio"
  },
  {
    "speaker": "Bella",
    "name": "Bella",
    "gender": "female",
    "description": "A loli who drinks but doesn't practice Drunken Fist.",
    "kind": "audio"
  },
  {
    "speaker": "Sunny",
    "name": "Sunny",
    "gender": "female",
    "description": "This Sichuan girl is sweet enough to melt your heart.",
    "kind": "audio"
  },
  {
    "speaker": "Bodega",
    "name": "Bodega",
    "gender": "male",
    "description": "An enthusiastic Spanish man's voice.",
    "kind": "audio"
  },
  {
    "speaker": "Alek",
    "name": "Alek",
    "gender": "male",
    "description": "A Russian voice that’s both cool and warm.",
    "kind": "audio"
  },
  {
    "speaker": "Elias",
    "name": "Elias",
    "gender": "female",
    "description": "Explains complex topics with academic rigor and clear storytelling.",
    "kind": "audio"
  },
  {
    "speaker": "Nini",
    "name": "Nini",
    "gender": "female",
    "description": "A voice as soft and sticky as mochi, its drawn-out \"gege\" calls sweet enough to melt your bones.",
    "kind": "audio"
  },
  {
    "speaker": "Dolce",
    "name": "Dolce",
    "gender": "male",
    "description": "Lazy Italian uncle",
    "kind": "audio"
  },
  {
    "speaker": "Vincent",
    "name": "Vincent",
    "gender": "male",
    "description": "A unique, raspy voice that evokes epic tales of heroism.",
    "kind": "audio"
  },
  {
    "speaker": "Tina",
    "name": "Tina",
    "gender": "female",
    "description": "My voice is like warm milk tea—sweet and cozy, but I’m absolutely clear-headed when it comes to solving problems!",
    "kind": "omni"
  },
  {
    "speaker": "Cindy",
    "name": "Cindy",
    "gender": "female",
    "description": "Taiwanese girls who speak in a cute, sweet voice",
    "kind": "omni"
  },
  {
    "speaker": "Liora Mira",
    "name": "Liora Mira",
    "gender": "female",
    "description": "Weave the tenderness of a vibrant human world with sound.",
    "kind": "omni"
  },
  {
    "speaker": "Sunnybobi",
    "name": "Sunnybobi",
    "gender": "female",
    "description": "A carefree yet socially anxious girl next door",
    "kind": "omni"
  },
  {
    "speaker": "Raymond",
    "name": "Raymond",
    "gender": "male",
    "description": "A homebody with a clear voice who loves ordering takeout.",
    "kind": "omni"
  },
  {
    "speaker": "Theo Calm",
    "name": "Theo Calm",
    "gender": "male",
    "description": "Convey understanding in silence, heal hearts through words.",
    "kind": "omni"
  },
  {
    "speaker": "Harvey",
    "name": "Harvey",
    "gender": "male",
    "description": "My voice emerges from the mellowing of time—deep, gentle, with a hint of coffee and old books.",
    "kind": "omni"
  },
  {
    "speaker": "Evan",
    "name": "Evan",
    "gender": "male",
    "description": "Male college student, younger \"puppy\" type",
    "kind": "omni"
  },
  {
    "speaker": "Qiao",
    "name": "Qiao",
    "gender": "female",
    "description": "Super crucial! She's not just ordinarily cute—she's a \"sweet-looking girl with a bold personality.\"",
    "kind": "omni"
  },
  {
    "speaker": "Wil",
    "name": "Wil",
    "gender": "male",
    "description": "A Hong Kong/Taiwan-accented guy who grew up in Shenzhen",
    "kind": "omni"
  },
  {
    "speaker": "Angel",
    "name": "Angel",
    "gender": "female",
    "description": "She has a slight Taiwanese accent and is super sweet!",
    "kind": "omni"
  },
  {
    "speaker": "Li Cassian",
    "name": "Li Cassian",
    "gender": "male",
    "description": "Leave three parts unsaid, and use seven parts to read between the lines.",
    "kind": "omni"
  },
  {
    "speaker": "Joyner",
    "name": "Joyner",
    "gender": "male",
    "description": "Funny, exaggerated, and down-to-earth",
    "kind": "omni"
  },
  {
    "speaker": "Gold",
    "name": "Gold",
    "gender": "male",
    "description": "West Coast Black rapper",
    "kind": "omni"
  },
  {
    "speaker": "Mione",
    "name": "Mione",
    "gender": "female",
    "description": "Mature, intelligent British girl-next-door",
    "kind": "omni"
  },
  {
    "speaker": "Joseph Chen",
    "name": "Joseph Chen",
    "gender": "male",
    "description": "I'm Ah Poh, my real name is Tan Chee Poh, an old overseas Chinese from Nanyang.",
    "kind": "omni"
  },
  {
    "speaker": "Rizky",
    "name": "Rizky",
    "gender": "male",
    "description": "Indonesian young guy with a distinctive voice",
    "kind": "omni"
  },
  {
    "speaker": "Roya",
    "name": "Roya",
    "gender": "female",
    "description": "A girl who loves sports and has a free spirit.",
    "kind": "omni"
  },
  {
    "speaker": "Arda",
    "name": "Arda",
    "gender": "male",
    "description": "Neither shrill nor low, it carries a clean, crisp quality with a gentle warmth.",
    "kind": "omni"
  },
  {
    "speaker": "Hana",
    "name": "Hana",
    "gender": "female",
    "description": "Vietnamese mature woman who loves dogs",
    "kind": "omni"
  },
  {
    "speaker": "Jakub",
    "name": "Jakub",
    "gender": "male",
    "description": "Artsy youth from a Polish town, with a magnetic and sexy voice",
    "kind": "omni"
  },
  {
    "speaker": "Griet",
    "name": "Griet",
    "gender": "female",
    "description": "A mature and artistic Dutch woman",
    "kind": "omni"
  },
  {
    "speaker": "Eliška",
    "name": "Eliška",
    "gender": "female",
    "description": "Every word conveys the craftsmanship and warmth of Central Europe.",
    "kind": "omni"
  },
  {
    "speaker": "Marina",
    "name": "Marina",
    "gender": "female",
    "description": "A girl who grew up in a multicultural city.",
    "kind": "omni"
  },
  {
    "speaker": "Siiri",
    "name": "Siiri",
    "gender": "female",
    "description": "Reserved and gentle, with a calm, unhurried voice like ripples on a lake.",
    "kind": "omni"
  },
  {
    "speaker": "Ingrid",
    "name": "Ingrid",
    "gender": "female",
    "description": "Norwegian country girl",
    "kind": "omni"
  },
  {
    "speaker": "Sigga",
    "name": "Sigga",
    "gender": "female",
    "description": "An intellectual young woman from an Icelandic town",
    "kind": "omni"
  },
  {
    "speaker": "Bea",
    "name": "Bea",
    "gender": "female",
    "description": "Sweet Filipino girl who loves coffee",
    "kind": "omni"
  },
  {
    "speaker": "Chloe",
    "name": "Chloe",
    "gender": "female",
    "description": "Malaysian white-collar women",
    "kind": "omni"
  }
];
