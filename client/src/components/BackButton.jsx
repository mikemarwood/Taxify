import { useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';

// The one way back from a signed-out page.
//
// There were three of these and they disagreed. The legal pages had a ghost
// button with an arrow, sign-up and password reset had a plain blue "Back to
// sign in" at the foot of the form, and support and the terms page had both at
// once — the shell's and their own, a few pixels apart. So this is the button,
// in one place, and everything that needs one uses it.
//
// Where it goes is history first: these pages are read from the middle of
// something. Terms is opened halfway through signing up, and the sign-up form
// keeps its draft, so going back lands on the same step with the same answers
// — which is what "back" should mean and what /login would have thrown away.
// Somebody who arrived from a link in an email has no history to return to,
// and sign-in is the useful place to put them.
export default function BackButton({ fallback = '/login', style }) {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(fallback))}
      style={{ fontSize: 13, gap: 7, marginBottom: 20, ...style }}
    >
      <Icon name="arrow-left" size={15} />
      Back
    </button>
  );
}
