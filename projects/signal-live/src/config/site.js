// Public settings only. Never put API tokens or stream keys in this file.
export const siteConfig = {
  name: 'Signal',
  tagline: 'Your front row, from anywhere.',
  streamer: { name: 'Alex Morgan', handle: '@alexcreates', bio: 'A curious mind. An open tab. A place to make things together. Join me for creative sessions, honest conversations, and whatever comes next.', avatar: '/images/avatar.svg' },
  logo: '/icons/favicon.svg',
  accent: '#dcff78',
  defaultStream: { title: 'Good ideas start with a little curiosity.', category: 'Just Chatting', description: 'Pull up a chair. We’re exploring new ideas, building things, and enjoying the process. Everyone’s welcome here.' },
  // Demo cards are examples, not claims about real recordings or broadcasts.
  demoSchedule: [
    { id: 'creative', title: 'The creative hour', category: 'Art & Design', day: 'WED', time: '7:00 PM', image: '/images/creative.svg', description: 'A blank canvas. A few ideas. Let’s see where it goes.' },
    { id: 'weekend', title: 'A slower kind of Sunday', category: 'Just Chatting', day: 'SUN', time: '11:00 AM', image: '/images/sunday.svg', description: 'Coffee, conversation, and a little reset for the week.' }
  ],
  archives: [], // Add {id,title,category,thumbnail,url,duration} after real recordings exist.
  socialLinks: [], // Add {label:'YouTube',url:'https://youtube.com/@YOURHANDLE'}.
  provider: 'mux', // Backend STREAM_PROVIDER controls actual provider selection.
  playbackId: '', // Optional PUBLIC playback ID; API controls live state.
  chatMode: 'local',
};
