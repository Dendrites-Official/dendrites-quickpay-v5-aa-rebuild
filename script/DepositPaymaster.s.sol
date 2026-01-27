// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";

contract DepositPaymaster is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY_DEPLOYER");
        address entryPoint = vm.envAddress("ENTRYPOINT");
        address paymaster = vm.envAddress("PAYMASTER");
        uint256 amountWei = vm.envUint("PAYMASTER_DEPOSIT_WEI");

        vm.startBroadcast(pk);
        IEntryPoint(entryPoint).depositTo{value: amountWei}(paymaster);
        vm.stopBroadcast();

        console2.log("PAYMASTER_DEPOSITED_WEI:", amountWei);
        console2.log("PAYMASTER:", paymaster);
    }
}
