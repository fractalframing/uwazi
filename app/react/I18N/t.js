import {store} from 'app/store';

let t = (context, key, _text) => {
  let text = _text || key;
  let state = store.getState();
  let translation = state.translations.toJS().find((d) => d.locale === state.locale) || {values: {}};
  let translationExists = translation.values[context] && translation.values[context][key];
  return translationExists ? translation.values[context][key] : text;
};

export default t;
