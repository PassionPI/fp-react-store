import type { FC, MemoExoticComponent, MutableRefObject } from "react";
import {
  createContext,
  createElement,
  Fragment,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type EmptyFn = () => void;
type EmptyFnKey = string | symbol;
type EmptyFnKeys = Set<EmptyFnKey>;

type SubMap = Map<EmptyFnKey, Set<EmptyFn>>;
type SubSet = Set<EmptyFnKey>;

const { is, assign, entries } = Object;
const { get, set, has } = Reflect;

function useFn<A extends unknown[], R>(
  fn: (...args: A) => R
): (...args: A) => R {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  return useCallback((...args) => fnRef.current(...args), []);
}

function getKeys<T extends object>(sets: Set<EmptyFnKey>, val: T) {
  return new Proxy(val, {
    get(t, p) {
      if (has(t, p)) {
        sets.add(p);
      }
      return get(t, p);
    },
  });
}

export function createStore<
  S extends object,
  H extends object,
  E extends Record<string, (a: any) => any>
>({
  state,
  effects,
  useHooks = () => ({} as H),
}: {
  state: () => S;
  effects: (method: {
    getStore: () => S & H;
    setStore: (
      setter: Partial<S & H> | ((value: S & H) => Partial<S & H>)
    ) => void;
  }) => Promise<E>;
  useHooks?: () => H;
}) {
  type Value = S & H;
  type Setter = Partial<S & H> | ((value: S & H) => Partial<S & H>);
  type Action<K extends keyof E> = Parameters<E[K]>[0] extends undefined
    ? { type: K; payload?: undefined }
    : {
        type: K;
        payload: Parameters<E[K]>[0];
      };
  type CtxValue = {
    sub: (fn: EmptyFn, key: EmptyFnKeys) => void;
    unsub: (fn: EmptyFn, key: EmptyFnKeys) => void;
    setStore: (setter: Setter) => void;
    getStore: () => Value;
    dispatch: <Key extends keyof E>(
      action: Action<Key>
    ) => Promise<Awaited<ReturnType<E[Key]>>>;
  };
  type RefCtxValue = MutableRefObject<CtxValue>;

  const CTX = createContext<RefCtxValue>({} as RefCtxValue);

  const useCtxValue = (): CtxValue => {
    const subs: SubMap = useMemo(() => new Map(), []);
    const keys: SubSet = useMemo(() => new Set(), []);

    const storeHooks = useHooks();
    const store = useMemo(() => assign(state(), storeHooks), []);

    const setValue = (value: Partial<Value>) => {
      for (const [p, v] of entries(value)) {
        if (has(store, p) && !is(get(store, p), v)) {
          set(store, p, v);
          keys.add(p);
        }
      }
      if (keys.size) {
        const pubs = new Set<EmptyFn>();
        keys.forEach((key) => subs.get(key)?.forEach((fn) => pubs.add(fn)));
        keys.clear();
        pubs.forEach((fn) => fn());
        pubs.clear();
      }
    };

    useEffect(() => {
      setValue(storeHooks);
    }, [storeHooks]);

    const sub: CtxValue["sub"] = useFn((fn, keysGet) => {
      keysGet.forEach((key) => {
        if (subs.has(key)) {
          subs.get(key)?.add(fn);
        } else {
          subs.set(key, new Set([fn]));
        }
      });
    });

    const unsub: CtxValue["unsub"] = useFn((fn, keysGet) => {
      keysGet.forEach((key) => subs.get(key)?.delete(fn));
    });

    const getStore: CtxValue["getStore"] = useFn(() => {
      return { ...store };
    });

    const setStore: CtxValue["setStore"] = useFn((setter) => {
      setValue(typeof setter == "function" ? setter(getStore()) : setter);
    });

    const dispatch: CtxValue["dispatch"] = useFn(async (action) => {
      const effect = await effects?.({ getStore, setStore });
      return effect?.[action?.type]?.(action?.payload);
    });

    return {
      sub,
      unsub,
      getStore,
      setStore,
      dispatch,
    };
  };

  const Store: FC<{ value: RefCtxValue }> = memo(({ value }) => {
    value.current = useCtxValue();
    return null;
  });

  return {
    useStore<R>(
      selector: (store: Value) => R,
      changed?: (prev: R, next: R) => boolean
    ) {
      const { sub, unsub, getStore } = useContext(CTX).current;
      const keySet = useMemo(() => new Set<EmptyFnKey>(), []);
      const [value, setValue] = useState(() =>
        selector(getKeys(keySet, getStore()))
      );
      useEffect(() => {
        const update = () => {
          setValue((prev) => {
            const next = selector(getStore());
            return changed ? (changed(prev, next) ? next : prev) : next;
          });
        };
        sub(update, keySet);
        return () => {
          unsub(update, keySet);
        };
      }, []);
      return value;
    },
    useDispatch() {
      return useContext(CTX).current.dispatch;
    },
    provider<T>(
      Component: FC<T>
    ): MemoExoticComponent<(props: T) => JSX.Element> {
      return memo((props: T) => {
        const value = useRef<CtxValue>({} as CtxValue);
        return createElement(
          Fragment,
          null,
          createElement(Store, { value }),
          createElement(
            CTX.Provider,
            { value },
            createElement(Component, props)
          )
        );
      });
    },
  };
}
