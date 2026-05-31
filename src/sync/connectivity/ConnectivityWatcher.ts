import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

export const startConnectivityWatcher = (): (() => void) => {
  console.log('ConnectivityWatcher: Starting...');
  
  const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
    if (state.isConnected && state.isInternetReachable) {
      console.log('CONNECTED');
    } else {
      console.log('DISCONNECTED');
    }
  });

  return unsubscribe;
};
