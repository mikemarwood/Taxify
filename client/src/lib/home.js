// Where a login belongs when it arrives with no particular destination.
//
// An accountant who also keeps their own books has two homes, so the answer is
// whichever one they can actually use: the client list if that is all they
// have, their own dashboard otherwise. Lives here rather than in App.jsx so
// the pages that navigate don't have to import the router that renders them.
export function homePathFor(user) {
  if (!user) return '/login';
  if (user.actingAsClient) return '/';
  if (user.role === 'accountant') return '/clients';
  // Their own side has lapsed but they still have clients — send them to the
  // work they can do rather than to a subscription wall.
  if (user.accessLocked && user.isAccountant) return '/clients';
  return '/';
}
